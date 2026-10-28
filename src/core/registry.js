"use strict";

const connectedWindowIds = new Set();
const connectedOutputs = new Set();
const connectedDockIds = new Set();
const warnedSignals = new Set();
const warnedTileIds = new Set();
const retriedOutput = new Set();

module.exports = {
    connectedWindowIds,
    connectedOutputs,
    connectedDockIds,
    warnedSignals,
    warnedTileIds,
    retriedOutput,
};
