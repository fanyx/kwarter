"use strict";

const { GAP, slotRects, directionalTarget, swapSlots } = require("../core/layout");
const { findStateContaining } = require("../core/state");
const { resolveRoot } = require("../core/windows");
const { scheduleApply } = require("../core/schedule");

function swapDirection(dx, dy) {
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
        print("kwarter: empty work area, skipping swap");
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
}

module.exports = {
    swapDirection,
};
