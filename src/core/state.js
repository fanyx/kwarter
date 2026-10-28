"use strict";

const { MAX_WINDOWS, chooseVictimIndex } = require("./layout");
const {
    isAlive,
    windowId,
    resolveOutput,
    desktopFor,
    windowOnActivity,
    resolveRoot,
    eligible,
    stateKey,
} = require("./windows");
const { connectedWindowIds } = require("./registry");
const { scheduleApply } = require("./schedule");

const states = {};

function stateFor(output, desktop) {
    const key = stateKey(output, desktop);
    let state = states[key];
    if (!state) {
        state = {
            key: key,
            output: output,
            desktop: desktop,
            slots: [],
            lru: [],
            minimized: [],
            applying: false,
            applyScheduled: false,
        };
        states[key] = state;
    }
    return state;
}

function findStateContaining(w) {
    if (!w) {
        return null;
    }
    const keys = Object.keys(states);
    for (let i = 0; i < keys.length; i++) {
        const state = states[keys[i]];
        if (
            state.slots.indexOf(w) !== -1 ||
            state.lru.indexOf(w) !== -1 ||
            state.minimized.indexOf(w) !== -1
        ) {
            return state;
        }
    }
    return null;
}

function detachFromState(state, w) {
    const slotIndex = state.slots.indexOf(w);
    if (slotIndex !== -1) {
        state.slots.splice(slotIndex, 1);
    }
    const lruIndex = state.lru.indexOf(w);
    if (lruIndex !== -1) {
        state.lru.splice(lruIndex, 1);
    }
    const minimizedIndex = state.minimized.indexOf(w);
    if (minimizedIndex !== -1) {
        state.minimized.splice(minimizedIndex, 1);
    }
}

function touch(state, w) {
    const index = state.lru.indexOf(w);
    if (index !== -1) {
        state.lru.splice(index, 1);
    }
    state.lru.push(w);
}

function sameTilingContext(a, b) {
    return (
        resolveOutput(a) === resolveOutput(b) &&
        desktopFor(a) === desktopFor(b) &&
        windowOnActivity(a) &&
        windowOnActivity(b)
    );
}

function chooseVictim(state) {
    const candidates = state.lru.filter(isAlive);
    if (candidates.length === 0) {
        return null;
    }

    const windows = workspace.windowList();
    const ids = candidates.map(windowId);
    const blocked = [];

    for (const candidate of candidates) {
        const candidateId = windowId(candidate);

        if (candidate.fullScreen) {
            blocked.push(candidateId);
            continue;
        }

        let hasVisibleChild = false;
        for (const other of windows) {
            if (!other || other.deleted || other.minimized) {
                continue;
            }
            if (windowId(other) === candidateId) {
                continue;
            }
            if (resolveRoot(other) !== candidate) {
                continue;
            }
            if (!sameTilingContext(other, candidate)) {
                continue;
            }
            hasVisibleChild = true;
            break;
        }
        if (hasVisibleChild) {
            blocked.push(candidateId);
        }
    }

    const index = chooseVictimIndex(ids, blocked);
    return index >= 0 ? candidates[index] : null;
}

function addToState(state, w) {
    if (state.slots.length < MAX_WINDOWS) {
        state.slots.push(w);
        touch(state, w);
        return;
    }

    let victim = chooseVictim(state);
    if (!victim) {
        victim = state.slots[0];
    }
    const index = state.slots.indexOf(victim);

    if (!victim || index === -1) {
        scheduleApply(state);
        return;
    }

    detachFromState(state, victim);
    victim.minimized = true;
    state.minimized.push(victim);

    state.slots.splice(index, 0, w);
    touch(state, w);
}

function pruneState(state) {
    const slots = state.slots.filter((w) => isAlive(w) && eligible(w));
    const minimized = state.minimized.filter((w) => isAlive(w) && eligible(w));

    for (const w of state.slots.concat(state.minimized)) {
        if (
            slots.indexOf(w) === -1 &&
            minimized.indexOf(w) === -1 &&
            !isAlive(w)
        ) {
            connectedWindowIds.delete(windowId(w));
        }
    }

    state.slots = slots;
    state.lru = state.lru.filter((w) => state.slots.indexOf(w) !== -1);
    state.minimized = minimized;

    if (state.slots.length === 0 && state.minimized.length === 0) {
        delete states[state.key];
    }
}

module.exports = {
    states,
    stateFor,
    findStateContaining,
    detachFromState,
    touch,
    sameTilingContext,
    chooseVictim,
    addToState,
    pruneState,
};
