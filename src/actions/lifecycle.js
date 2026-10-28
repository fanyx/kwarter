"use strict";

const {
    findStateContaining,
    stateFor,
    addToState,
    detachFromState,
    touch,
} = require("../core/state");
const {
    eligible,
    desktopFor,
    resolveOutput,
    windowId,
    isAlive,
    windowOnActivity,
    detachNativeTile,
} = require("../core/windows");
const {
    retriedOutput,
    connectedWindowIds,
    connectedDockIds,
} = require("../core/registry");
const { scheduleApply } = require("../core/schedule");
const { defer } = require("../core/timing");

let windowConnector = null;

function setWindowConnector(fn) {
    windowConnector = fn;
}

function addWindow(w) {
    try {
        if (!eligible(w)) {
            return;
        }

        if (windowConnector) {
            windowConnector(w);
        }

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
        print(`kwarter: addWindow failed: ${e}`);
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
                print(`kwarter: failed to activate restored window ${windowId(restored)}: ${e}`);
            }
        }
    } catch (e) {
        print(`kwarter: removeWindow failed: ${e}`);
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
        print(`kwarter: replayExistingWindows failed: ${e}`);
    }
}

module.exports = {
    addWindow,
    removeWindow,
    replayExistingWindows,
    setWindowConnector,
};
