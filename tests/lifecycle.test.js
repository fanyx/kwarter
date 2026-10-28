const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { states } = require("../src/core/state");
const { currentDesktopFor } = require("../src/core/windows");
const { setApplyHandler } = require("../src/core/schedule");
const {
    addWindow,
    removeWindow,
    setWindowConnector,
} = require("../src/actions/lifecycle");

const output = { name: "DP-1" };
const desktop = { id: "desk-a" };
let windowList = [];
let fakeWorkspace;

class FakeTimer {
    constructor() {
        this.timeout = { connect: (fn) => { this.handler = fn; } };
    }
    start() {
        if (this.handler) {
            this.handler();
        }
    }
}

function makeWindow(id, overrides = {}) {
    const w = Object.assign({
        internalId: id,
        normalWindow: true,
        managed: true,
        deleted: false,
        transient: false,
        dialog: false,
        popupWindow: false,
        specialWindow: false,
        onAllDesktops: false,
        fullScreen: false,
        minimized: false,
        tile: null,
        output,
        desktops: [desktop],
        activities: ["act-a"],
        stackingOrder: 0,
        transientFor: null,
    }, overrides);
    windowList.push(w);
    return w;
}

beforeEach(() => {
    windowList = [];
    for (const key of Object.keys(states)) {
        delete states[key];
    }
    fakeWorkspace = {
        screens: [output],
        desktops: [desktop],
        activeScreen: output,
        currentDesktop: desktop,
        currentActivity: "act-a",
        activeWindow: null,
        windowList: () => windowList,
        currentDesktopForScreen: () => desktop,
    };
    global.workspace = fakeWorkspace;
    global.QTimer = FakeTimer;
    global.print = () => {};
    setApplyHandler(() => {});
    setWindowConnector(() => {});
});

afterEach(() => {
    delete global.workspace;
    delete global.QTimer;
    delete global.print;
});

test("currentDesktopFor prefers the per-output desktop", () => {
    const otherDesktop = { id: "desk-b" };
    fakeWorkspace.currentDesktop = otherDesktop;
    fakeWorkspace.currentDesktopForScreen = (screen) =>
        screen === output ? desktop : otherDesktop;

    assert.equal(currentDesktopFor(output), desktop);
    assert.equal(currentDesktopFor({ name: "HDMI-A-1" }), otherDesktop);
    assert.equal(currentDesktopFor(null), otherDesktop);
});

test("four windows fill slots in order", () => {
    const windows = [1, 2, 3, 4].map((n) => makeWindow(`w${n}`));
    windows.forEach(addWindow);

    const state = states["DP-1|desk-a"];
    assert.ok(state);
    assert.deepEqual(state.slots, windows);
    assert.deepEqual(state.lru, windows);
    assert.deepEqual(state.minimized, []);
});

test("fifth window minimizes the least recently focused window", () => {
    const windows = [1, 2, 3, 4, 5].map((n) => makeWindow(`w${n}`));
    for (let i = 0; i < 4; i++) {
        addWindow(windows[i]);
    }
    addWindow(windows[4]);

    const state = states["DP-1|desk-a"];
    assert.deepEqual(state.slots, [windows[4], windows[1], windows[2], windows[3]]);
    assert.deepEqual(state.minimized, [windows[0]]);
    assert.equal(windows[0].minimized, true);
});

test("closing a visible window restores the newest minimized window into its slot", () => {
    const windows = [1, 2, 3, 4, 5].map((n) => makeWindow(`w${n}`));
    windows.forEach(addWindow);

    windowList = windowList.filter((w) => w !== windows[2]);
    removeWindow(windows[2]);

    const state = states["DP-1|desk-a"];
    assert.deepEqual(state.slots, [windows[4], windows[1], windows[0], windows[3]]);
    assert.deepEqual(state.minimized, []);
    assert.equal(windows[0].minimized, false);
    assert.equal(fakeWorkspace.activeWindow, windows[0]);
});

test("closing a minimized window does not restore another window", () => {
    const windows = [1, 2, 3, 4, 5].map((n) => makeWindow(`w${n}`));
    windows.forEach(addWindow);

    windowList = windowList.filter((w) => w !== windows[0]);
    removeWindow(windows[0]);

    const state = states["DP-1|desk-a"];
    assert.equal(state.slots.length, 4);
    assert.deepEqual(state.minimized, []);
});
