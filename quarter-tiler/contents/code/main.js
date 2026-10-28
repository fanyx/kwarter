const GAP = 6;
const MAX_WINDOWS = 4;

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

function slotRects(count, area, gap) {
    if (count === 1) {
        return [{ x: area.x, y: area.y, width: area.width, height: area.height }];
    }

    const fractions = SLOT_FRACTIONS[count];
    if (!fractions) {
        return [];
    }

    const inset = Math.round(gap / 2);
    return fractions.map(([fx, fy, fw, fh]) => ({
        x: Math.round(area.x + fx * area.width) + inset,
        y: Math.round(area.y + fy * area.height) + inset,
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
    if (activeIndex < 0 || activeIndex >= rects.length) {
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
const retriedOutput = new Set();
const generatedIds = new WeakMap();
let nextGeneratedId = 0;

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

function isAlive(w) {
    return Boolean(w && !w.deleted && workspace.windowList().indexOf(w) !== -1);
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
            if (resolveRoot(other) === candidate) {
                hasVisibleChild = true;
                break;
            }
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

    const victim = chooseVictim(state) || state.slots[0];
    const index = state.slots.indexOf(victim);

    if (!victim || index === -1) {
        state.slots.push(w);
        touch(state, w);
        return;
    }

    detachFromState(state, victim);
    victim.minimized = true;
    state.minimized.push(victim);

    state.slots.splice(index, 0, w);
    touch(state, w);
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

        const activities = w.activities;
        if (
            activities &&
            activities.length > 0 &&
            activities.indexOf(workspace.currentActivity) === -1
        ) {
            return;
        }

        const desktop = desktopFor(w);
        const output = w.output || workspace.activeScreen;

        if (!output) {
            if (!retriedOutput.has(w)) {
                retriedOutput.add(w);
                Qt.callLater(() => addWindow(w));
            }
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

        if (wasVisible && state.minimized.length > 0) {
            const restored = state.minimized.pop();
            restored.minimized = false;
            state.slots.splice(index, 0, restored);
            touch(state, restored);
            workspace.activeWindow = restored;
        }

        scheduleApply(state);
    } catch (e) {
        print(`quarter-tiler: removeWindow failed: ${e}`);
    }
}

function pruneState(state) {
    state.slots = state.slots.filter((w) => isAlive(w) && eligible(w));
    state.lru = state.lru.filter((w) => state.slots.indexOf(w) !== -1);
    state.minimized = state.minimized.filter((w) => isAlive(w) && eligible(w));

    if (state.slots.length === 0 && state.minimized.length === 0) {
        delete states[state.key];
    }
}

function scheduleApply(state) {
    if (state.applyScheduled) {
        return;
    }
    state.applyScheduled = true;
    Qt.callLater(() => {
        state.applyScheduled = false;
        applyState(state);
    });
}

function verifyState(state, targets) {
    if (!state || !targets || targets.length === 0) {
        return;
    }

    Qt.callLater(() => {
        for (const target of targets) {
            try {
                const w = target.w;
                if (!isAlive(w) || w.fullScreen) {
                    continue;
                }
                if (!rectsClose(w.frameGeometry, target.rect, 1)) {
                    const rect = target.rect;
                    w.frameGeometry = Qt.rect(rect.x, rect.y, rect.width, rect.height);
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

        const n = state.slots.length;
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
            const only = state.slots[0];
            if (!only.fullScreen) {
                only.setMaximize(true, true);
            }
            return;
        }

        for (const w of state.slots) {
            if (w.setMaximize) {
                w.setMaximize(false, false);
            }
        }

        const rects = slotRects(n, area, GAP);
        const targets = [];

        for (let i = 0; i < n; i++) {
            const w = state.slots[i];
            if (!w || w.fullScreen) {
                continue;
            }
            const minSize = w.minSize || { width: 0, height: 0 };
            const rect = fitToMinSize(rects[i], minSize);
            w.frameGeometry = Qt.rect(rect.x, rect.y, rect.width, rect.height);
            targets.push({ w: w, rect: rect });
        }

        verifyState(state, targets);
    } catch (e) {
        print(`quarter-tiler: applyState failed: ${e}`);
    } finally {
        state.applying = false;
    }
}

function connectSignal(signal, handler) {
    if (signal && typeof signal.connect === "function") {
        signal.connect(handler);
    }
}

function connectWindowSignals(w) {
    const id = windowId(w);
    if (connectedWindowIds.has(id)) {
        return;
    }
    connectedWindowIds.add(id);

    connectSignal(w.minimizedChanged, () => onMinimizedChanged(w));
    connectSignal(w.fullScreenChanged, () => onFullScreenChanged(w));
    connectSignal(w.maximizedChanged, () => onMaximizedChanged(w));
}

function onWindowAdded(w) {
    try {
        Qt.callLater(() => {
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

function onMinimizedChanged(w) {
    try {
        const state = findStateContaining(w);
        if (!state) {
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
        swapSlots,
        fitToMinSize,
        rectsClose,
        eligible,
        stateKey,
        resolveRoot,
        states,
        stateFor,
        findStateContaining,
        detachFromState,
        touch,
        chooseVictim,
        addToState,
        addWindow,
        removeWindow,
        scheduleApply,
        verifyState,
        applyState,
        pruneState,
        isAlive,
        windowId,
        desktopFor,
        replayExistingWindows,
        main,
    };
} else {
    main();
}
