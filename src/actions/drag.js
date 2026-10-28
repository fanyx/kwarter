"use strict";

const { swapSlots } = require("../core/layout");
const {
    findStateContaining,
    detachFromState,
    stateFor,
    addToState,
} = require("../core/state");
const { isAlive, desktopFor } = require("../core/windows");
const { scheduleApply } = require("../core/schedule");
const { defer } = require("../core/timing");

let activeDrag = null;
let pendingDrop = null;

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
    if (activeDrag && !isAlive(activeDrag.window)) {
        activeDrag = null;
    }
    activeDrag = { window: w, resizing: dragIsResize(w) };
}

function onInteractiveMoveResizeFinished(w) {
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
        } finally {
            if (pendingDrop && pendingDrop.window === w) {
                pendingDrop = null;
            }
        }
    });
}

function windowsAt(pos) {
    const found = workspace.windowAt(pos, -1);
    return found ? Array.from(found) : [];
}

function handleDrop(w, resizing) {
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

module.exports = {
    dragIsResize,
    onInteractiveMoveResizeStarted,
    onInteractiveMoveResizeFinished,
    windowsAt,
    handleDrop,
    isDragOwned,
};
