"use strict";

const { swapDirection } = require("./actions/swap");

function registerShortcutLogged(title, text, sequence, callback) {
    const shortcutTitle = `Kwarter: ${title}`;
    const shortcutText = `Kwarter: ${text}`;
    if (!registerShortcut(shortcutTitle, shortcutText, sequence, callback)) {
        print(`kwarter: failed to register shortcut "${shortcutTitle}" (${sequence})`);
    }
}

function registerAllShortcuts() {
    registerShortcutLogged(
        "Swap Left",
        "Swap window left",
        "Meta+Left",
        () => swapDirection(-1, 0)
    );
    registerShortcutLogged(
        "Swap Right",
        "Swap window right",
        "Meta+Right",
        () => swapDirection(1, 0)
    );
    registerShortcutLogged(
        "Swap Up",
        "Swap window up",
        "Meta+Up",
        () => swapDirection(0, -1)
    );
    registerShortcutLogged(
        "Swap Down",
        "Swap window down",
        "Meta+Down",
        () => swapDirection(0, 1)
    );
}

module.exports = {
    registerShortcutLogged,
    registerAllShortcuts,
};
