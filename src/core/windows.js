"use strict";

const { warnedTileIds } = require("./registry");

const generatedIds = new WeakMap();
let nextGeneratedId = 0;

function windowId(w) {
    if (!w) {
        return "";
    }
    if (w.internalId !== undefined && w.internalId !== null) {
        return String(w.internalId);
    }
    let id = generatedIds.get(w);
    if (id === undefined) {
        id = `window-${nextGeneratedId++}`;
        generatedIds.set(w, id);
    }
    return id;
}

function desktopFor(w) {
    if (w.desktops && w.desktops.length > 0) {
        return w.desktops[0];
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
    if (!list) {
        return false;
    }
    for (let i = 0; i < list.length; i++) {
        if (list[i] === item) {
            return true;
        }
    }
    return false;
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
    const visited = new Set();
    while (current && current.transientFor) {
        const id = current.internalId !== undefined ? current.internalId : current;
        if (visited.has(id)) {
            break;
        }
        visited.add(id);
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
    resolveOutput,
    isAlive,
    windowOnActivity,
    eligible,
    stateKey,
    resolveRoot,
    detachNativeTile,
    contains,
};
