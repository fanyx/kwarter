"use strict";

const { defer } = require("./timing");

let applyHandler = null;

function setApplyHandler(fn) {
    applyHandler = fn;
}

function scheduleApply(state) {
    if (state.applyScheduled) {
        return;
    }
    state.applyScheduled = true;
    defer(() => {
        state.applyScheduled = false;
        if (applyHandler) {
            applyHandler(state);
        }
    });
}

module.exports = {
    scheduleApply,
    setApplyHandler,
};
