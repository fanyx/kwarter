"use strict";

const { warnedTileIds } = require("./registry");

function windowId(w) {
    return w && w.internalId !== undefined && w.internalId !== null
        ? String(w.internalId)
        : "";
}

function desktopFor(w) {
    if (w.desktops && w.desktops.length > 0) {
        return w.desktops[0];
    }
    return workspace.currentDesktop;
}

function currentDesktopFor(output) {
    if (output && typeof workspace.currentDesktopForScreen === "function") {
        const desktop = workspace.currentDesktopForScreen(output);
        if (desktop) {
            return desktop;
        }
    }
    return workspace.currentDesktop;
}

function resolveOutput(w) {
    const screens = workspace.screens;
    const reported = w && w.output;
    if (!screens) {
        return reported || workspace.activeScreen || null;
    }
    if (reported && contains(screens, reported)) {
        return reported;
    }
    const active = workspace.activeScreen;
    if (active && contains(screens, active)) {
        return active;
    }
    return null;
}

function isAlive(w) {
    return Boolean(w && !w.deleted && workspace.windowList().indexOf(w) !== -1);
}

function windowOnActivity(w) {
    if (!w) {
        return false;
    }
    const activities = w.activities;
    return (
        !activities ||
        activities.length === 0 ||
        activities.indexOf(workspace.currentActivity) !== -1
    );
}

function contains(list, item) {
    return Boolean(list) && Array.prototype.includes.call(list, item);
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
    while (current && current.transientFor) {
        current = current.transientFor;
    }
    return current;
}

function detachNativeTile(w) {
    try {
        if (w.tile === null || w.tile === undefined) {
            return true;
        }
        w.tile = null;
        if (w.tile !== null && w.tile !== undefined) {
            const id = windowId(w);
            if (!warnedTileIds.has(id)) {
                warnedTileIds.add(id);
                print(`kwarter: native tile still attached for ${id}`);
            }
            return false;
        }
        return true;
    } catch (e) {
        const id = windowId(w);
        if (!warnedTileIds.has(id)) {
            warnedTileIds.add(id);
            print(`kwarter: failed to detach native tile for ${id}: ${e}`);
        }
        return false;
    }
}

module.exports = {
    windowId,
    desktopFor,
    currentDesktopFor,
    resolveOutput,
    isAlive,
    windowOnActivity,
    eligible,
    stateKey,
    resolveRoot,
    detachNativeTile,
    contains,
};
