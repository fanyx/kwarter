"use strict";

const {
    states,
    findStateContaining,
    detachFromState,
    stateFor,
    addToState,
} = require("../core/state");
const {
    windowId,
    resolveOutput,
    desktopFor,
    eligible,
    stateKey,
    windowOnActivity,
    contains,
} = require("../core/windows");
const {
    connectedOutputs,
    connectedDockIds,
    warnedSignals,
} = require("../core/registry");
const { scheduleApply } = require("../core/schedule");
const { addWindow } = require("../actions/lifecycle");
const { isDragOwned } = require("../actions/drag");

function connectSignal(signal, handler, name) {
    if (signal && typeof signal.connect === "function") {
        signal.connect(handler);
        return true;
    }
    const label = name || "signal";
    if (!warnedSignals.has(label)) {
        warnedSignals.add(label);
        print(`kwarter: missing optional signal or feature: ${label}`);
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
        print(`kwarter: onDockGeometryChanged failed: ${e}`);
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
        print(`kwarter: connectDockWindows failed: ${e}`);
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
        print(`kwarter: onCurrentDesktopChanged failed: ${e}`);
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
        print(`kwarter: onCurrentActivityChanged failed: ${e}`);
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
        print(`kwarter: onScreensChanged failed: ${e}`);
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
        print(`kwarter: onOutputGeometryChanged failed: ${e}`);
    }
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
        print(`kwarter: onDesktopsChanged failed: ${e}`);
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
        print(`kwarter: onOutputChanged failed: ${e}`);
    }
}

module.exports = {
    connectSignal,
    isDockWindow,
    connectDockSignals,
    onDockGeometryChanged,
    connectDockWindows,
    connectOutputSignals,
    moveWindowBetweenStates,
    onCurrentDesktopChanged,
    onCurrentActivityChanged,
    onScreensChanged,
    onOutputGeometryChanged,
    onDesktopsChanged,
    onOutputChanged,
};
