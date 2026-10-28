"use strict";

const { swapDirection } = require("./actions/swap");

function registerShortcutLogged(title, text, sequence, callback) {
    if (!registerShortcut(title, text, sequence, callback)) {
        print(`kwarter: failed to register shortcut "${title}" (${sequence})`);
    }
}

function registerAllShortcuts() {
    registerShortcutLogged(
        "Kwarter: Swap Left",
        "Swap window left",
        "Meta+Left",
        () => swapDirection(-1, 0)
    );
    registerShortcutLogged(
        "Kwarter: Swap Right",
        "Swap window right",
        "Meta+Right",
        () => swapDirection(1, 0)
    );
    registerShortcutLogged(
        "Kwarter: Swap Up",
        "Swap window up",
        "Meta+Up",
        () => swapDirection(0, -1)
    );
    registerShortcutLogged(
        "Kwarter: Swap Down",
        "Swap window down",
        "Meta+Down",
        () => swapDirection(0, 1)
    );
}

module.exports = {
    registerShortcutLogged,
    registerAllShortcuts,
};
