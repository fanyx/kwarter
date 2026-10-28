"use strict";

const {
    findStateContaining,
    detachFromState,
    touch,
    addToState,
} = require("../core/state");
const {
    windowId,
    resolveRoot,
    eligible,
    windowOnActivity,
} = require("../core/windows");
const { connectedWindowIds } = require("../core/registry");
const { scheduleApply } = require("../core/schedule");
const { defer } = require("../core/timing");
const {
    addWindow,
    removeWindow,
    setWindowConnector,
} = require("../actions/lifecycle");
const {
    onInteractiveMoveResizeStarted,
    onInteractiveMoveResizeFinished,
    isDragOwned,
} = require("../actions/drag");
const {
    connectSignal,
    isDockWindow,
    connectDockSignals,
    onDesktopsChanged,
    onOutputChanged,
} = require("./workspace");

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
    if (isDockWindow(w)) {
        connectDockSignals(w);
        return;
    }
    defer(() => {
        addWindow(w);
    });
}

function onWindowRemoved(w) {
    removeWindow(w);
}

function onWindowActivated(w) {
    const root = resolveRoot(w);
    const state = findStateContaining(root);
    if (state && state.slots.indexOf(root) !== -1) {
        touch(state, root);
    }
}

function onActivitiesChanged(w) {
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
}

function onMinimizedChanged(w) {
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
}

function onFullScreenChanged(w) {
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
}

function onMaximizedChanged(w) {
    const state = findStateContaining(w);
    if (state && !state.applying) {
        scheduleApply(state);
    }
}

setWindowConnector(connectWindowSignals);

module.exports = {
    connectWindowSignals,
    onWindowAdded,
    onWindowRemoved,
    onWindowActivated,
    onActivitiesChanged,
    onMinimizedChanged,
    onFullScreenChanged,
    onMaximizedChanged,
};
