const GAP = 6;
const MAX_WINDOWS = 4;

var pendingTimers = [];
function defer(fn) {
    var timer = new QTimer();
    pendingTimers.push(timer);
    timer.singleShot = true;
    timer.interval = 0;
    timer.timeout.connect(function () {
        var index = pendingTimers.indexOf(timer);
        if (index >= 0) pendingTimers.splice(index, 1);
        fn();
    });
    timer.start(0);
}

function plainRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

const SLOT_FRACTIONS = {
    2: [
        [0, 0, 0.5, 1],
        [0.5, 0, 0.5, 1],
    ],
    3: [
        [0, 0, 0.5, 1],
        [0.5, 0, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
    ],
    4: [
        [0, 0, 0.5, 0.5],
        [0.5, 0, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
        [0, 0.5, 0.5, 0.5],
    ],
};

function slotRects(count, area, gap = GAP) {
    if (count === 1) {
        return [{ x: area.x, y: area.y, width: area.width, height: area.height }];
    }

    const fractions = SLOT_FRACTIONS[count];
    if (!fractions) {
        return [];
    }

    const inset = Math.round(gap / 2);
    return fractions.map(([fx, fy, fw, fh]) => ({
        x: area.x + Math.round(fx * area.width) + inset,
        y: area.y + Math.round(fy * area.height) + inset,
        width: Math.round(fw * area.width) - 2 * inset,
        height: Math.round(fh * area.height) - 2 * inset,
    }));
}

function directionalTarget(rects, activeIndex, dx, dy) {
    if (!Array.isArray(rects)) {
        return -1;
    }
    if (dx === 0 && dy === 0) {
        return -1;
    }
    if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= rects.length) {
        return -1;
    }

    const active = rects[activeIndex];
    const activeX = active.x + active.width / 2;
    const activeY = active.y + active.height / 2;

    let best = -1;
    let bestScore = Infinity;

    for (let i = 0; i < rects.length; i++) {
        if (i === activeIndex) {
            continue;
        }

        const candidate = rects[i];
        const vx = candidate.x + candidate.width / 2 - activeX;
        const vy = candidate.y + candidate.height / 2 - activeY;

        if (dx < 0 && vx >= 0) continue;
        if (dx > 0 && vx <= 0) continue;
        if (dy < 0 && vy >= 0) continue;
        if (dy > 0 && vy <= 0) continue;

        const primary = dx !== 0 ? vx : vy;
        const lateral = dx !== 0 ? vy : vx;
        const score = Math.abs(primary) + 2 * Math.abs(lateral);

        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }

    return best;
}

function chooseVictimIndex(lruIds, blockedIds) {
    if (lruIds.length === 0) {
        return -1;
    }
    for (let i = 0; i < lruIds.length; i++) {
        if (!blockedIds.includes(lruIds[i])) {
            return i;
        }
    }
    return 0;
}

function swapSlots(slots, a, b) {
    const copy = slots.slice();
    const tmp = copy[a];
    copy[a] = copy[b];
    copy[b] = tmp;
    return copy;
}

function fitToMinSize(rect, minSize) {
    return {
        x: rect.x,
        y: rect.y,
        width: Math.max(rect.width, minSize.width),
        height: Math.max(rect.height, minSize.height),
    };
}

function rectsClose(a, b, tolerance) {
    return (
        Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance
    );
}

function eligible(w) {
    return Boolean(
        w &&
        w.normalWindow &&
        w.managed &&
        !w.deleted &&
        !w.transient &&
        !w.dialog &&
        !w.popupWindow &&
        !w.specialWindow &&
        !w.onAllDesktops
    );
}

function stateKey(output, desktop) {
    return `${output.name}|${desktop.id}`;
}

function resolveRoot(w) {
    let current = w;
    const visited = new Set();
    while (current && current.transientFor) {
        const id = current.internalId !== undefined ? current.internalId : current;
        if (visited.has(id)) {
            break;
        }
        visited.add(id);
        current = current.transientFor;
    }
    return current;
}

const states = {};
const connectedWindowIds = new Set();
const connectedOutputs = new Set();
const connectedDockIds = new Set();
const warnedSignals = new Set();
const warnedTileIds = new Set();
const retriedOutput = new Set();
const generatedIds = new WeakMap();
let nextGeneratedId = 0;
let activeDrag = null;
let pendingDrop = null;

function windowId(w) {
    if (!w) {
        return "";
    }
    if (w.internalId !== undefined && w.internalId !== null) {
        return String(w.internalId);
    }
    let id = generatedIds.get(w);
    if (id === undefined) {
        id = `window-${nextGeneratedId++}`;
        generatedIds.set(w, id);
    }
    return id;
}

function desktopFor(w) {
    if (w.desktops && w.desktops.length > 0) {
        return w.desktops[0];
    }
    return workspace.currentDesktop;
}

function resolveOutput(w) {
    const screens = workspace.screens;
    const reported = w && w.output;
    if (!screens) {
        return reported || workspace.activeScreen || null;
    }
    if (reported && contains(screens, reported)) {
        return reported;
    }
    const active = workspace.activeScreen;
    if (active && contains(screens, active)) {
        return active;
    }
    return null;
}

function isAlive(w) {
    return Boolean(w && !w.deleted && workspace.windowList().indexOf(w) !== -1);
}

function windowOnActivity(w) {
    if (!w) {
        return false;
    }
    const activities = w.activities;
    return (
        !activities ||
        activities.length === 0 ||
        activities.indexOf(workspace.currentActivity) !== -1
    );
}

function contains(list, item) {
    if (!list) {
        return false;
    }
    for (let i = 0; i < list.length; i++) {
        if (list[i] === item) {
            return true;
        }
    }
    return false;
}

function stateFor(output, desktop) {
    const key = stateKey(output, desktop);
    let state = states[key];
    if (!state) {
        state = {
            key: key,
            output: output,
            desktop: desktop,
            slots: [],
            lru: [],
            minimized: [],
            applying: false,
            applyScheduled: false,
        };
        states[key] = state;
    }
    return state;
}

function findStateContaining(w) {
    if (!w) {
        return null;
    }
    const keys = Object.keys(states);
    for (let i = 0; i < keys.length; i++) {
        const state = states[keys[i]];
        if (
            state.slots.indexOf(w) !== -1 ||
            state.lru.indexOf(w) !== -1 ||
            state.minimized.indexOf(w) !== -1
        ) {
            return state;
        }
    }
    return null;
}

function detachFromState(state, w) {
    const slotIndex = state.slots.indexOf(w);
    if (slotIndex !== -1) {
        state.slots.splice(slotIndex, 1);
    }
    const lruIndex = state.lru.indexOf(w);
    if (lruIndex !== -1) {
        state.lru.splice(lruIndex, 1);
    }
    const minimizedIndex = state.minimized.indexOf(w);
    if (minimizedIndex !== -1) {
        state.minimized.splice(minimizedIndex, 1);
    }
}

function touch(state, w) {
    const index = state.lru.indexOf(w);
    if (index !== -1) {
        state.lru.splice(index, 1);
    }
    state.lru.push(w);
}

function sameTilingContext(a, b) {
    return (
        resolveOutput(a) === resolveOutput(b) &&
        desktopFor(a) === desktopFor(b) &&
        windowOnActivity(a) &&
        windowOnActivity(b)
    );
}

function chooseVictim(state) {
    const candidates = state.lru.filter(isAlive);
    if (candidates.length === 0) {
        return null;
    }

    const windows = workspace.windowList();
    const ids = candidates.map(windowId);
    const blocked = [];

    for (const candidate of candidates) {
        const candidateId = windowId(candidate);

        if (candidate.fullScreen) {
            blocked.push(candidateId);
            continue;
        }

        let hasVisibleChild = false;
        for (const other of windows) {
            if (!other || other.deleted || other.minimized) {
                continue;
            }
            if (windowId(other) === candidateId) {
                continue;
            }
            if (resolveRoot(other) !== candidate) {
                continue;
            }
            if (!sameTilingContext(other, candidate)) {
                continue;
            }
            hasVisibleChild = true;
            break;
        }
        if (hasVisibleChild) {
            blocked.push(candidateId);
        }
    }

    const index = chooseVictimIndex(ids, blocked);
    return index >= 0 ? candidates[index] : null;
}

function addToState(state, w) {
    if (state.slots.length < MAX_WINDOWS) {
        state.slots.push(w);
        touch(state, w);
        return;
    }

    let victim = chooseVictim(state);
    if (!victim) {
        victim = state.slots[0];
    }
    const index = state.slots.indexOf(victim);

    if (!victim || index === -1) {
        scheduleApply(state);
        return;
    }

    detachFromState(state, victim);
    victim.minimized = true;
    state.minimized.push(victim);

    state.slots.splice(index, 0, w);
    touch(state, w);
}

function detachNativeTile(w) {
    try {
        if (w.tile === null || w.tile === undefined) {
            return true;
        }
        w.tile = null;
        if (w.tile !== null && w.tile !== undefined) {
            const id = windowId(w);
            if (!warnedTileIds.has(id)) {
                warnedTileIds.add(id);
                print(`quarter-tiler: native tile still attached for ${id}`);
            }
            return false;
        }
        return true;
    } catch (e) {
        const id = windowId(w);
        if (!warnedTileIds.has(id)) {
            warnedTileIds.add(id);
            print(`quarter-tiler: failed to detach native tile for ${id}: ${e}`);
        }
        return false;
    }
}

function addWindow(w) {
    try {
        if (!eligible(w)) {
            return;
        }

        connectWindowSignals(w);

        if (findStateContaining(w)) {
            return;
        }
        if (w.fullScreen) {
            return;
        }

        if (!windowOnActivity(w)) {
            return;
        }

        const desktop = desktopFor(w);
        const output = resolveOutput(w);

        if (!output) {
            if (!retriedOutput.has(w)) {
                retriedOutput.add(w);
                defer(() => addWindow(w));
            }
            return;
        }

        if (!detachNativeTile(w)) {
            return;
        }

        retriedOutput.delete(w);
        const state = stateFor(output, desktop);

        if (w.minimized) {
            if (state.minimized.indexOf(w) === -1) {
                state.minimized.push(w);
            }
            return;
        }

        addToState(state, w);
        scheduleApply(state);
    } catch (e) {
        print(`quarter-tiler: addWindow failed: ${e}`);
    }
}

function removeWindow(w) {
    try {
        retriedOutput.delete(w);
        connectedWindowIds.delete(windowId(w));
        connectedDockIds.delete(windowId(w));

        const state = findStateContaining(w);
        if (!state) {
            return;
        }

        const wasVisible = state.slots.indexOf(w) !== -1;
        const index = state.slots.indexOf(w);

        detachFromState(state, w);

        while (state.minimized.length > 0 && !isAlive(state.minimized[state.minimized.length - 1])) {
            state.minimized.pop();
        }

        let restored = null;
        if (wasVisible && state.minimized.length > 0) {
            restored = state.minimized.pop();
            restored.minimized = false;
            state.slots.splice(index, 0, restored);
            touch(state, restored);
        }

        scheduleApply(state);

        if (restored) {
            try {
                workspace.activeWindow = restored;
            } catch (e) {
                print(`quarter-tiler: failed to activate restored window ${windowId(restored)}: ${e}`);
            }
        }
    } catch (e) {
        print(`quarter-tiler: removeWindow failed: ${e}`);
    }
}

function pruneState(state) {
    const slots = state.slots.filter((w) => isAlive(w) && eligible(w));
    const minimized = state.minimized.filter((w) => isAlive(w) && eligible(w));

    for (const w of state.slots.concat(state.minimized)) {
        if (
            slots.indexOf(w) === -1 &&
            minimized.indexOf(w) === -1 &&
            !isAlive(w)
        ) {
            connectedWindowIds.delete(windowId(w));
        }
    }

    state.slots = slots;
    state.lru = state.lru.filter((w) => state.slots.indexOf(w) !== -1);
    state.minimized = minimized;

    if (state.slots.length === 0 && state.minimized.length === 0) {
        delete states[state.key];
    }
}

function scheduleApply(state) {
    if (state.applyScheduled) {
        return;
    }
    state.applyScheduled = true;
    defer(() => {
        state.applyScheduled = false;
        applyState(state);
    });
}

function maximizeModeOf(w) {
    try {
        if (typeof w.maximizeMode === "number") {
            return w.maximizeMode;
        }
        if (typeof w.maximizeMode === "function") {
            return w.maximizeMode();
        }
        if (typeof w.maximized === "boolean") {
            return w.maximized ? 3 : 0;
        }
    } catch (e) {
        print(`quarter-tiler: failed to read maximize state for ${windowId(w)}: ${e}`);
    }
    return null;
}

function setMaximizeIfNeeded(w, vertical, horizontal) {
    if (!w || typeof w.setMaximize !== "function") {
        return;
    }
    if (w.fullScreen) {
        return;
    }

    const desired = (vertical ? 1 : 0) | (horizontal ? 2 : 0);
    const current = maximizeModeOf(w);
    if (current !== null && (current & 3) === desired) {
        return;
    }

    w.setMaximize(vertical, horizontal);
}

function verifyState(state, targets) {
    if (!state || !targets || targets.length === 0) {
        return;
    }

    defer(() => {
        for (const target of targets) {
            try {
                const w = target.w;
                if (!isAlive(w) || w.fullScreen) {
                    continue;
                }
                if (findStateContaining(w) !== state || state.slots.indexOf(w) === -1) {
                    continue;
                }
                if (!rectsClose(w.frameGeometry, target.rect, 1)) {
                    w.frameGeometry = plainRect(target.rect);
                }
            } catch (e) {
                print(`quarter-tiler: verifyState failed: ${e}`);
            }
        }
    });
}

function applyState(state) {
    if (state.applying) {
        return;
    }
    if (!contains(workspace.screens, state.output)) {
        return;
    }
    if (!contains(workspace.desktops, state.desktop)) {
        return;
    }

    state.applying = true;
    try {
        pruneState(state);

        const slots = state.slots.slice();
        const n = slots.length;
        if (n === 0) {
            if (state.minimized.length === 0) {
                delete states[state.key];
            }
            return;
        }

        const area = workspace.clientArea(KWin.MaximizeArea, state.output, state.desktop);
        if (!area || area.width <= 0 || area.height <= 0) {
            print("quarter-tiler: empty work area, skipping apply");
            return;
        }

        if (n === 1) {
            const only = slots[0];
            if (only && detachNativeTile(only)) {
                setMaximizeIfNeeded(only, true, true);
            }
            return;
        }

        for (const w of slots) {
            if (!w || w.fullScreen) {
                continue;
            }
            if (!detachNativeTile(w)) {
                continue;
            }
            setMaximizeIfNeeded(w, false, false);
        }

        const rects = slotRects(n, area, GAP);
        const targets = [];

        for (let i = 0; i < n; i++) {
            const w = slots[i];
            if (!w || w.fullScreen) {
                continue;
            }
            if (!detachNativeTile(w)) {
                continue;
            }
            const minSize = w.minSize || { width: 0, height: 0 };
            const rect = fitToMinSize(rects[i], minSize);
            w.frameGeometry = plainRect(rect);
            targets.push({ w: w, rect: rect });
        }

        verifyState(state, targets);
    } catch (e) {
        print(`quarter-tiler: applyState failed: ${e}`);
    } finally {
        state.applying = false;
    }
}

function swapDirection(dx, dy) {
    try {
        const activeWindow = workspace.activeWindow;
        if (!activeWindow) {
            return;
        }

        const root = resolveRoot(activeWindow);
        const state = findStateContaining(root);
        if (!state) {
            return;
        }

        const activeIndex = state.slots.indexOf(root);
        if (activeIndex === -1) {
            return;
        }
        if (state.slots.length < 2) {
            return;
        }
        if (root.fullScreen) {
            return;
        }

        const area = workspace.clientArea(KWin.MaximizeArea, state.output, state.desktop);
        if (!area || area.width <= 0 || area.height <= 0) {
            print("quarter-tiler: empty work area, skipping swap");
            return;
        }

        const rects = slotRects(state.slots.length, area, GAP);
        const targetIndex = directionalTarget(rects, activeIndex, dx, dy);
        if (targetIndex === -1) {
            return;
        }

        state.slots = swapSlots(state.slots, activeIndex, targetIndex);
        scheduleApply(state);

        if (activeWindow === root) {
            workspace.activeWindow = root;
        }
    } catch (e) {
        print(`quarter-tiler: swapDirection failed: ${e}`);
    }
}

function registerShortcutLogged(title, text, sequence, callback) {
    try {
        if (!registerShortcut(title, text, sequence, callback)) {
            print(`quarter-tiler: failed to register shortcut "${title}" (${sequence})`);
        }
    } catch (e) {
        print(`quarter-tiler: failed to register shortcut "${title}" (${sequence}): ${e}`);
    }
}

function registerAllShortcuts() {
    registerShortcutLogged(
        "Quarter Tiler: Swap Left",
        "Swap window left",
        "Meta+Left",
        () => swapDirection(-1, 0)
    );
    registerShortcutLogged(
        "Quarter Tiler: Swap Right",
        "Swap window right",
        "Meta+Right",
        () => swapDirection(1, 0)
    );
    registerShortcutLogged(
        "Quarter Tiler: Swap Up",
        "Swap window up",
        "Meta+Up",
        () => swapDirection(0, -1)
    );
    registerShortcutLogged(
        "Quarter Tiler: Swap Down",
        "Swap window down",
        "Meta+Down",
        () => swapDirection(0, 1)
    );
}

function dragIsResize(w) {
    if (w.resize === true) {
        return true;
    }
    if (w.move === true) {
        return false;
    }
    return false;
}

function onInteractiveMoveResizeStarted(w) {
    try {
        if (activeDrag && !isAlive(activeDrag.window)) {
            activeDrag = null;
        }
        activeDrag = { window: w, resizing: dragIsResize(w) };
    } catch (e) {
        print(`quarter-tiler: onInteractiveMoveResizeStarted failed: ${e}`);
    }
}

function onInteractiveMoveResizeFinished(w) {
    try {
        let drag = activeDrag;
        if (drag && !isAlive(drag.window)) {
            drag = null;
        }
        activeDrag = null;
        const resizing = Boolean(drag && drag.window === w ? drag.resizing : false);
        pendingDrop = { window: w, resizing: resizing };
        defer(() => {
            try {
                handleDrop(w, resizing);
            } catch (e) {
                print(`quarter-tiler: deferred drop failed: ${e}`);
            } finally {
                if (pendingDrop && pendingDrop.window === w) {
                    pendingDrop = null;
                }
            }
        });
    } catch (e) {
        print(`quarter-tiler: onInteractiveMoveResizeFinished failed: ${e}`);
    }
}

function windowsAt(pos) {
    const found = workspace.windowAt(pos, -1);
    if (!found) {
        return [];
    }
    if (Array.isArray(found)) {
        return found;
    }
    if (typeof found.length === "number") {
        const list = [];
        for (let i = 0; i < found.length; i++) {
            list.push(found[i]);
        }
        return list;
    }
    return [found];
}

function handleDrop(w, resizing) {
    try {
        if (!isAlive(w)) {
            return;
        }

        const source = findStateContaining(w);
        if (!source || source.slots.indexOf(w) === -1) {
            return;
        }
        if (w.fullScreen) {
            return;
        }

        if (resizing) {
            scheduleApply(source);
            return;
        }

        const pos = workspace.cursorPos;
        const output = workspace.screenAt(pos) || w.output;
        const destination = stateFor(output, desktopFor(w));

        if (destination !== source) {
            detachFromState(source, w);
            addToState(destination, w);
            scheduleApply(source);
            scheduleApply(destination);
            return;
        }

        const windows = windowsAt(pos);
        let target = null;
        for (const candidate of windows) {
            if (!candidate || candidate === w || !isAlive(candidate)) {
                continue;
            }
            target = candidate;
            break;
        }

        if (
            target &&
            !target.fullScreen &&
            source.slots.indexOf(target) !== -1
        ) {
            const sourceIndex = source.slots.indexOf(w);
            const targetIndex = source.slots.indexOf(target);
            source.slots = swapSlots(source.slots, sourceIndex, targetIndex);
        }

        scheduleApply(source);
    } catch (e) {
        print(`quarter-tiler: handleDrop failed: ${e}`);
    }
}

function connectSignal(signal, handler, name) {
    if (signal && typeof signal.connect === "function") {
        signal.connect(handler);
        return true;
    }
    const label = name || "signal";
    if (!warnedSignals.has(label)) {
        warnedSignals.add(label);
        print(`quarter-tiler: missing optional signal or feature: ${label}`);
    }
    return false;
}

function isDockWindow(w) {
    return Boolean(w && !w.deleted && (w.dock || w.specialWindow));
}

function connectDockSignals(w) {
    const id = windowId(w);
    if (connectedDockIds.has(id)) {
        return;
    }
    connectedDockIds.add(id);
    connectSignal(
        w.frameGeometryChanged,
        () => onDockGeometryChanged(w),
        "window.frameGeometryChanged"
    );
}

function onDockGeometryChanged(w) {
    try {
        const output = resolveOutput(w);
        if (!output) {
            return;
        }
        for (const key of Object.keys(states)) {
            const state = states[key];
            if (state.output === output) {
                scheduleApply(state);
            }
        }
    } catch (e) {
        print(`quarter-tiler: onDockGeometryChanged failed: ${e}`);
    }
}

function connectDockWindows() {
    try {
        for (const w of workspace.windowList()) {
            if (isDockWindow(w)) {
                connectDockSignals(w);
            }
        }
    } catch (e) {
        print(`quarter-tiler: connectDockWindows failed: ${e}`);
    }
}

function connectOutputSignals(output) {
    if (!output || connectedOutputs.has(output)) {
        return;
    }
    connectedOutputs.add(output);
    connectSignal(
        output.geometryChanged,
        () => onOutputGeometryChanged(output),
        "output.geometryChanged"
    );
}

function moveWindowBetweenStates(w, oldState) {
    if (!oldState) {
        return;
    }
    const output = resolveOutput(w);
    const desktop = desktopFor(w);
    if (!output || !desktop) {
        return;
    }
    if (stateKey(output, desktop) === oldState.key) {
        return;
    }

    detachFromState(oldState, w);
    const state = stateFor(output, desktop);
    if (w.minimized) {
        if (state.minimized.indexOf(w) === -1) {
            state.minimized.push(w);
        }
    } else {
        addToState(state, w);
    }
    scheduleApply(oldState);
    scheduleApply(state);
}

function onCurrentDesktopChanged() {
    try {
        const desktop = workspace.currentDesktop;
        for (const w of workspace.windowList()) {
            if (
                eligible(w) &&
                desktopFor(w) === desktop &&
                !findStateContaining(w)
            ) {
                addWindow(w);
            }
        }
        for (const key of Object.keys(states)) {
            if (states[key].desktop === desktop) {
                scheduleApply(states[key]);
            }
        }
    } catch (e) {
        print(`quarter-tiler: onCurrentDesktopChanged failed: ${e}`);
    }
}

function onCurrentActivityChanged() {
    try {
        const affected = [];
        for (const key of Object.keys(states)) {
            const state = states[key];
            const tracked = Array.from(
                new Set(state.slots.concat(state.minimized, state.lru))
            );
            let touched = false;
            for (const w of tracked) {
                if (!windowOnActivity(w)) {
                    detachFromState(state, w);
                    touched = true;
                }
            }
            if (touched) {
                affected.push(state);
            }
        }
        for (const state of affected) {
            scheduleApply(state);
        }
        for (const w of workspace.windowList()) {
            if (eligible(w) && windowOnActivity(w) && !findStateContaining(w)) {
                addWindow(w);
            }
        }
    } catch (e) {
        print(`quarter-tiler: onCurrentActivityChanged failed: ${e}`);
    }
}

function onScreensChanged() {
    try {
        for (const output of connectedOutputs) {
            if (!contains(workspace.screens, output)) {
                connectedOutputs.delete(output);
            }
        }
        for (const output of workspace.screens) {
            connectOutputSignals(output);
        }
        for (const key of Object.keys(states)) {
            const state = states[key];
            if (contains(workspace.screens, state.output)) {
                continue;
            }
            const tracked = Array.from(
                new Set(state.slots.concat(state.minimized, state.lru))
            );
            for (const w of tracked) {
                detachFromState(state, w);
            }
            delete states[key];
        }
        for (const w of workspace.windowList()) {
            if (eligible(w) && !findStateContaining(w)) {
                addWindow(w);
            }
        }
        for (const key of Object.keys(states)) {
            scheduleApply(states[key]);
        }
    } catch (e) {
        print(`quarter-tiler: onScreensChanged failed: ${e}`);
    }
}

function onOutputGeometryChanged(output) {
    try {
        for (const key of Object.keys(states)) {
            const state = states[key];
            if (state.output === output) {
                scheduleApply(state);
            }
        }
    } catch (e) {
        print(`quarter-tiler: onOutputGeometryChanged failed: ${e}`);
    }
}

function isDragOwned(w) {
    if (activeDrag && activeDrag.window === w) {
        return true;
    }
    if (pendingDrop && pendingDrop.window === w) {
        return true;
    }
    return false;
}

function onDesktopsChanged(w) {
    try {
        if (isDragOwned(w)) {
            return;
        }
        const state = findStateContaining(w);
        if (state && state.applying) {
            scheduleApply(state);
            return;
        }
        moveWindowBetweenStates(w, state);
    } catch (e) {
        print(`quarter-tiler: onDesktopsChanged failed: ${e}`);
    }
}

function onOutputChanged(w) {
    try {
        if (isDragOwned(w)) {
            return;
        }
        const state = findStateContaining(w);
        if (state && state.applying) {
            scheduleApply(state);
            return;
        }
        moveWindowBetweenStates(w, state);
    } catch (e) {
        print(`quarter-tiler: onOutputChanged failed: ${e}`);
    }
}

function connectWindowSignals(w) {
    const id = windowId(w);
    if (connectedWindowIds.has(id)) {
        return;
    }
    connectedWindowIds.add(id);

    connectSignal(w.minimizedChanged, () => onMinimizedChanged(w), "window.minimizedChanged");
    connectSignal(w.fullScreenChanged, () => onFullScreenChanged(w), "window.fullScreenChanged");
    connectSignal(w.maximizedChanged, () => onMaximizedChanged(w), "window.maximizedChanged");
    connectSignal(
        w.interactiveMoveResizeStarted,
        () => onInteractiveMoveResizeStarted(w),
        "window.interactiveMoveResizeStarted"
    );
    connectSignal(
        w.interactiveMoveResizeFinished,
        () => onInteractiveMoveResizeFinished(w),
        "window.interactiveMoveResizeFinished"
    );
    connectSignal(w.desktopsChanged, () => onDesktopsChanged(w), "window.desktopsChanged");
    connectSignal(w.outputChanged, () => onOutputChanged(w), "window.outputChanged");
    connectSignal(w.activitiesChanged, () => onActivitiesChanged(w), "window.activitiesChanged");
}

function onWindowAdded(w) {
    try {
        if (isDockWindow(w)) {
            connectDockSignals(w);
            return;
        }
        defer(() => {
            try {
                addWindow(w);
            } catch (e) {
                print(`quarter-tiler: deferred add failed: ${e}`);
            }
        });
    } catch (e) {
        print(`quarter-tiler: onWindowAdded failed: ${e}`);
    }
}

function onWindowRemoved(w) {
    try {
        removeWindow(w);
    } catch (e) {
        print(`quarter-tiler: onWindowRemoved failed: ${e}`);
    }
}

function onWindowActivated(w) {
    try {
        const root = resolveRoot(w);
        const state = findStateContaining(root);
        if (state && state.slots.indexOf(root) !== -1) {
            touch(state, root);
        }
    } catch (e) {
        print(`quarter-tiler: onWindowActivated failed: ${e}`);
    }
}

function onActivitiesChanged(w) {
    try {
        if (isDragOwned(w)) {
            return;
        }
        const state = findStateContaining(w);
        if (state && state.applying) {
            scheduleApply(state);
            return;
        }
        if (!windowOnActivity(w)) {
            if (state) {
                detachFromState(state, w);
                scheduleApply(state);
            }
            return;
        }
        if (!state && eligible(w)) {
            addWindow(w);
            return;
        }
        if (state) {
            scheduleApply(state);
        }
    } catch (e) {
        print(`quarter-tiler: onActivitiesChanged failed: ${e}`);
    }
}

function onMinimizedChanged(w) {
    try {
        const state = findStateContaining(w);
        if (!state) {
            return;
        }
        if (state.applying) {
            scheduleApply(state);
            return;
        }

        if (w.minimized) {
            if (state.slots.indexOf(w) === -1) {
                return;
            }
            detachFromState(state, w);
            if (state.minimized.indexOf(w) === -1) {
                state.minimized.push(w);
            }
            scheduleApply(state);
            return;
        }

        if (state.minimized.indexOf(w) === -1) {
            return;
        }
        detachFromState(state, w);
        addToState(state, w);
        scheduleApply(state);
    } catch (e) {
        print(`quarter-tiler: onMinimizedChanged failed: ${e}`);
    }
}

function onFullScreenChanged(w) {
    try {
        const state = findStateContaining(w);
        if (state && state.applying) {
            scheduleApply(state);
            return;
        }

        if (state && state.slots.indexOf(w) !== -1) {
            scheduleApply(state);
            return;
        }

        if (!w.fullScreen && !state && eligible(w)) {
            addWindow(w);
        }
    } catch (e) {
        print(`quarter-tiler: onFullScreenChanged failed: ${e}`);
    }
}

function onMaximizedChanged(w) {
    try {
        const state = findStateContaining(w);
        if (state && !state.applying) {
            scheduleApply(state);
        }
    } catch (e) {
        print(`quarter-tiler: onMaximizedChanged failed: ${e}`);
    }
}

function replayExistingWindows() {
    try {
        const currentDesktop = workspace.currentDesktop;
        const windows = workspace
            .windowList()
            .filter((w) => eligible(w) && desktopFor(w) === currentDesktop)
            .sort((a, b) => (a.stackingOrder || 0) - (b.stackingOrder || 0));

        for (const w of windows) {
            addWindow(w);
        }
    } catch (e) {
        print(`quarter-tiler: replayExistingWindows failed: ${e}`);
    }
}

function main() {
    try {
        workspace.windowAdded.connect(onWindowAdded);
        workspace.windowRemoved.connect(onWindowRemoved);
        workspace.windowActivated.connect(onWindowActivated);
        connectSignal(
            workspace.currentDesktopChanged,
            onCurrentDesktopChanged,
            "workspace.currentDesktopChanged"
        );
        connectSignal(
            workspace.currentActivityChanged,
            onCurrentActivityChanged,
            "workspace.currentActivityChanged"
        );
        connectSignal(workspace.screensChanged, onScreensChanged, "workspace.screensChanged");
        for (const output of workspace.screens) {
            connectOutputSignals(output);
        }
        connectDockWindows();
        registerAllShortcuts();
        replayExistingWindows();
    } catch (e) {
        print(`quarter-tiler: main failed: ${e}`);
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        GAP,
        MAX_WINDOWS,
        slotRects,
        directionalTarget,
        chooseVictimIndex,
        chooseVictim,
        swapSlots,
        fitToMinSize,
        rectsClose,
        eligible,
        stateKey,
        resolveRoot,
        main,
    };
} else {
    main();
}
