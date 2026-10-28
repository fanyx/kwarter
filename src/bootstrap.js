"use strict";

const {
    onWindowAdded,
    onWindowRemoved,
    onWindowActivated,
} = require("./signals/window");
const {
    connectSignal,
    connectOutputSignals,
    connectDockWindows,
    onCurrentDesktopChanged,
    onDesktopListChanged,
    onCurrentActivityChanged,
    onScreensChanged,
} = require("./signals/workspace");
const { registerAllShortcuts } = require("./shortcuts");
const { replayExistingWindows } = require("./actions/lifecycle");
const { applyState } = require("./core/apply");
const { setApplyHandler } = require("./core/schedule");

function main() {
    setApplyHandler(applyState);
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
    connectSignal(
        workspace.desktopsChanged,
        onDesktopListChanged,
        "workspace.desktopsChanged"
    );
    connectSignal(workspace.screensChanged, onScreensChanged, "workspace.screensChanged");
    for (const output of workspace.screens) {
        connectOutputSignals(output);
    }
    connectDockWindows();
    registerAllShortcuts();
    replayExistingWindows();
}

module.exports = {
    main,
};
