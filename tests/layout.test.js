const test = require("node:test");
const assert = require("node:assert/strict");
const {
    GAP,
    MAX_WINDOWS,
    slotRects,
    directionalTarget,
    chooseVictimIndex,
    swapSlots,
    fitToMinSize,
    rectsClose,
} = require("../src/core/layout.js");
const { eligible, stateKey, resolveRoot } = require("../src/core/windows.js");
const { chooseVictim } = require("../src/core/state.js");
const { main } = require("../src/bootstrap.js");

const AREA = { x: 0, y: 0, width: 1000, height: 800 };

function rects(count, area = AREA, gap = GAP) {
    return slotRects(count, area, gap);
}

function win(overrides = {}) {
    return Object.assign({
        normalWindow: true,
        managed: true,
        deleted: false,
        transient: false,
        dialog: false,
        popupWindow: false,
        specialWindow: false,
        onAllDesktops: false,
    }, overrides);
}

test("exports constants and a callable main stub", () => {
    assert.equal(GAP, 6);
    assert.equal(MAX_WINDOWS, 4);
    assert.equal(typeof main, "function");
});

test("one window uses the full work area without a gap", () => {
    assert.deepEqual(rects(1), [{ x: 0, y: 0, width: 1000, height: 800 }]);
});

test("two windows split left and right with a 6px gap", () => {
    assert.deepEqual(rects(2), [
        { x: 3, y: 3, width: 494, height: 794 },
        { x: 503, y: 3, width: 494, height: 794 },
    ]);
});

test("three windows use left half plus right top and right bottom", () => {
    assert.deepEqual(rects(3), [
        { x: 3, y: 3, width: 494, height: 794 },
        { x: 503, y: 3, width: 494, height: 394 },
        { x: 503, y: 403, width: 494, height: 394 },
    ]);
});

test("four windows use quarters in TL, TR, BR, BL order", () => {
    assert.deepEqual(rects(4), [
        { x: 3, y: 3, width: 494, height: 394 },
        { x: 503, y: 3, width: 494, height: 394 },
        { x: 503, y: 403, width: 494, height: 394 },
        { x: 3, y: 403, width: 494, height: 394 },
    ]);
});

test("slot rectangles respect a non-zero work-area origin", () => {
    assert.deepEqual(rects(2, { x: 100, y: 50, width: 1000, height: 800 }), [
        { x: 103, y: 53, width: 494, height: 794 },
        { x: 603, y: 53, width: 494, height: 794 },
    ]);
});

test("directional target finds horizontal and vertical neighbours", () => {
    assert.equal(directionalTarget(rects(2), 0, 1, 0), 1);
    assert.equal(directionalTarget(rects(2), 1, -1, 0), 0);
    assert.equal(directionalTarget(rects(2), 0, 0, 1), -1);

    assert.equal(directionalTarget(rects(3), 0, 1, 0), 1);
    assert.equal(directionalTarget(rects(3), 1, -1, 0), 0);
    assert.equal(directionalTarget(rects(3), 1, 0, 1), 2);
    assert.equal(directionalTarget(rects(3), 2, 0, -1), 1);
    assert.equal(directionalTarget(rects(3), 2, 1, 0), -1);

    assert.equal(directionalTarget(rects(4), 0, 1, 0), 1);
    assert.equal(directionalTarget(rects(4), 0, 0, 1), 3);
    assert.equal(directionalTarget(rects(4), 1, 0, 1), 2);
    assert.equal(directionalTarget(rects(4), 2, -1, 0), 3);
    assert.equal(directionalTarget(rects(4), 3, 0, -1), 0);
});

test("directional target returns -1 when there is no candidate", () => {
    assert.equal(directionalTarget(rects(1), 0, 1, 0), -1);
    assert.equal(directionalTarget([], 0, 1, 0), -1);
    assert.equal(directionalTarget(rects(2), 0, 0, 0), -1);
});

test("victim selection skips blocked windows and falls back to the first", () => {
    assert.equal(chooseVictimIndex(["a", "b", "c"], []), 0);
    assert.equal(chooseVictimIndex(["a", "b", "c"], ["a"]), 1);
    assert.equal(chooseVictimIndex(["a", "b", "c"], ["a", "b"]), 2);
    assert.equal(chooseVictimIndex(["a", "b", "c"], ["a", "b", "c"]), 0);
    assert.equal(chooseVictimIndex([], []), -1);
});

test("chooseVictim blocks parents with visible children and handles fallbacks", () => {
    const output = { name: "DP-1" };
    const desktop = { id: "desk-a" };
    const otherDesktop = { id: "desk-b" };
    const previous = global.workspace;

    const parent = win({
        internalId: "parent",
        output: output,
        desktops: [desktop],
        activities: ["act-a"],
        fullScreen: false,
    });
    const other = win({
        internalId: "other",
        output: output,
        desktops: [desktop],
        activities: ["act-a"],
        fullScreen: false,
    });
    const fullscreenParent = win({
        internalId: "full-parent",
        output: output,
        desktops: [desktop],
        activities: ["act-a"],
        fullScreen: true,
    });
    function child(id, target, childDesktop = desktop) {
        return {
            internalId: id,
            transientFor: target,
            deleted: false,
            minimized: false,
            output: output,
            desktops: [childDesktop],
            activities: ["act-a"],
        };
    }

    global.workspace = {
        screens: [output],
        activeScreen: output,
        currentDesktop: desktop,
        currentActivity: "act-a",
        windowList: () => [],
    };

    try {
        const parentChild = child("parent-child", parent);
        const otherChild = child("other-child", other);
        const remoteChild = child("remote-child", parent, otherDesktop);

        global.workspace.windowList = () => [parent, other, parentChild];
        assert.equal(chooseVictim({ lru: [parent, other] }), other);

        global.workspace.windowList = () => [parent, other, parentChild, otherChild];
        assert.equal(chooseVictim({ lru: [parent, other] }), parent);

        global.workspace.windowList = () => [fullscreenParent, other];
        assert.equal(chooseVictim({ lru: [fullscreenParent, other] }), other);

        global.workspace.windowList = () => [parent, other, remoteChild];
        assert.equal(chooseVictim({ lru: [parent, other] }), parent);
    } finally {
        global.workspace = previous;
    }
});

test("swapSlots returns a new array with two entries exchanged", () => {
    const before = ["a", "b", "c"];
    assert.deepEqual(swapSlots(before, 0, 2), ["c", "b", "a"]);
    assert.deepEqual(before, ["a", "b", "c"]);
    assert.deepEqual(swapSlots(before, 1, 1), ["a", "b", "c"]);
});

test("fitToMinSize raises width and height to the minimum", () => {
    assert.deepEqual(
        fitToMinSize({ x: 10, y: 20, width: 100, height: 100 }, { width: 200, height: 50 }),
        { x: 10, y: 20, width: 200, height: 100 }
    );
    assert.deepEqual(
        fitToMinSize({ x: 10, y: 20, width: 100, height: 100 }, { width: 50, height: 150 }),
        { x: 10, y: 20, width: 100, height: 150 }
    );
});

test("rectsClose compares with a tolerance", () => {
    const a = { x: 1, y: 2, width: 3, height: 4 };
    assert.equal(rectsClose(a, { x: 2, y: 3, width: 4, height: 5 }, 1), true);
    assert.equal(rectsClose(a, { x: 3, y: 2, width: 3, height: 4 }, 1), false);
});

test("eligible accepts normal managed windows and rejects transients and specials", () => {
    assert.equal(eligible(win()), true);
    for (const key of [
        "normalWindow",
        "managed",
        "transient",
        "dialog",
        "popupWindow",
        "specialWindow",
        "onAllDesktops",
    ]) {
        const bad = win({ [key]: key === "normalWindow" || key === "managed" ? false : true });
        assert.equal(eligible(bad), false, key);
    }
    assert.equal(eligible(win({ deleted: true })), false);
    assert.equal(eligible(null), false);
});

test("stateKey joins output name and desktop id", () => {
    assert.equal(stateKey({ name: "DP-1" }, { id: "desk-a" }), "DP-1|desk-a");
});

test("resolveRoot follows transientFor to the top-level parent", () => {
    const root = { internalId: "root", transientFor: null };
    const child = { internalId: "child", transientFor: root };
    const grandchild = { internalId: "grandchild", transientFor: child };
    assert.equal(resolveRoot(grandchild), root);
    assert.equal(resolveRoot(root), root);
});
