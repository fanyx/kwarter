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
    try {
        if (activeDrag && !isAlive(activeDrag.window)) {
            activeDrag = null;
        }
        activeDrag = { window: w, resizing: dragIsResize(w) };
    } catch (e) {
        print(`kwarter: onInteractiveMoveResizeStarted failed: ${e}`);
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
                print(`kwarter: deferred drop failed: ${e}`);
            } finally {
                if (pendingDrop && pendingDrop.window === w) {
                    pendingDrop = null;
                }
            }
        });
    } catch (e) {
        print(`kwarter: onInteractiveMoveResizeFinished failed: ${e}`);
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
        print(`kwarter: handleDrop failed: ${e}`);
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

module.exports = {
    activeDrag,
    pendingDrop,
    dragIsResize,
    onInteractiveMoveResizeStarted,
    onInteractiveMoveResizeFinished,
    windowsAt,
    handleDrop,
    isDragOwned,
};
