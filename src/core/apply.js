"use strict";

const { GAP, slotRects, fitToMinSize, rectsClose } = require("./layout");
const {
    isAlive,
    windowId,
    detachNativeTile,
    contains,
} = require("./windows");
const { states, findStateContaining, pruneState } = require("./state");
const { defer } = require("./timing");

function plainRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
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
        print(`kwarter: failed to read maximize state for ${windowId(w)}: ${e}`);
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
                print(`kwarter: verifyState failed: ${e}`);
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
            print("kwarter: empty work area, skipping apply");
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
        print(`kwarter: applyState failed: ${e}`);
    } finally {
        state.applying = false;
    }
}

module.exports = {
    plainRect,
    maximizeModeOf,
    setMaximizeIfNeeded,
    verifyState,
    applyState,
};
