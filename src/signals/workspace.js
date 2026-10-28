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
    currentDesktopFor,
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

const outputHandlers = new Map();

function trackedWindows(state) {
    return Array.from(new Set(state.slots.concat(state.minimized, state.lru)));
}

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
}

function connectDockWindows() {
    for (const w of workspace.windowList()) {
        if (isDockWindow(w)) {
            connectDockSignals(w);
        }
    }
}

function connectOutputSignals(output) {
    if (!output || connectedOutputs.has(output)) {
        return;
    }
    const handler = () => onOutputGeometryChanged(output);
    connectedOutputs.add(output);
    outputHandlers.set(output, handler);
    connectSignal(
        output.geometryChanged,
        handler,
        "output.geometryChanged"
    );
}

function disconnectOutputSignals(output) {
    const handler = outputHandlers.get(output);
    if (
        handler &&
        output &&
        output.geometryChanged &&
        typeof output.geometryChanged.disconnect === "function"
    ) {
        output.geometryChanged.disconnect(handler);
    }
    outputHandlers.delete(output);
    connectedOutputs.delete(output);
}

function moveWindowBetweenStates(w, oldState) {
    if (!oldState) {
        return;
    }
    const output = w && w.output;
    const desktop = desktopFor(w);
    if (!output || !desktop || !contains(workspace.screens, output)) {
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

function onCurrentDesktopChanged(previous, current, output) {
    const targetOutput = output || null;
    const desktop = current || currentDesktopFor(targetOutput || workspace.activeScreen);
    for (const w of workspace.windowList()) {
        if (
            eligible(w) &&
            desktopFor(w) === desktop &&
            (!targetOutput || resolveOutput(w) === targetOutput) &&
            !findStateContaining(w)
        ) {
            addWindow(w);
        }
    }
    for (const key of Object.keys(states)) {
        const state = states[key];
        if (
            state.desktop === desktop &&
            (!targetOutput || state.output === targetOutput)
        ) {
            scheduleApply(state);
        }
    }
}

function onDesktopListChanged() {
    for (const key of Object.keys(states)) {
        const state = states[key];
        if (contains(workspace.desktops, state.desktop)) {
            continue;
        }
        const tracked = trackedWindows(state);
        for (const w of tracked) {
            detachFromState(state, w);
        }
        delete states[key];
    }
    for (const w of workspace.windowList()) {
        if (
            eligible(w) &&
            desktopFor(w) === currentDesktopFor(resolveOutput(w)) &&
            !findStateContaining(w)
        ) {
            addWindow(w);
        }
    }
    for (const key of Object.keys(states)) {
        scheduleApply(states[key]);
    }
}

function onCurrentActivityChanged() {
    const affected = [];
    for (const key of Object.keys(states)) {
        const state = states[key];
        const tracked = trackedWindows(state);
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
}

function onScreensChanged() {
    for (const output of Array.from(connectedOutputs)) {
        if (!contains(workspace.screens, output)) {
            disconnectOutputSignals(output);
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
        const tracked = trackedWindows(state);
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
}

function onOutputGeometryChanged(output) {
    for (const key of Object.keys(states)) {
        const state = states[key];
        if (state.output === output) {
            scheduleApply(state);
        }
    }
}

function onDesktopsChanged(w) {
    if (isDragOwned(w)) {
        return;
    }
    const state = findStateContaining(w);
    if (state && state.applying) {
        scheduleApply(state);
        return;
    }
    moveWindowBetweenStates(w, state);
}

function onOutputChanged(w) {
    if (isDragOwned(w)) {
        return;
    }
    const state = findStateContaining(w);
    if (state && state.applying) {
        scheduleApply(state);
        return;
    }
    moveWindowBetweenStates(w, state);
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
    onDesktopListChanged,
    onCurrentActivityChanged,
    onScreensChanged,
    onOutputGeometryChanged,
    onDesktopsChanged,
    onOutputChanged,
};
