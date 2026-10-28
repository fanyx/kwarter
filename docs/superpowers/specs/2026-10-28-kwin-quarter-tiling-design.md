# Automatic Quarter Tiling for KWin 6 — Design Document

- Date: 2026-10-28
- Status: Design approved; awaiting written-spec review
- Target: KDE Plasma 6, KWin 6.x, Wayland session
- Scope: One KWin script package, maximum four tiled windows per screen
- Shortcut names: `Meta+Arrow` (Meta is the Super key)

## 1. Summary

This document specifies a KWin script that keeps up to four normal application windows tiled on each screen. The layout follows a fixed growth order: one window is maximized, two split left/right, three use a full-height left half plus a split right half, and four use equal quarters. Opening a fifth window minimizes the least recently focused tiled window. Closing a visible window restores the most recently minimized window into the freed slot.

Dialogs, popups, and other transient windows are never tiled or counted. They float above their parent window using KWin's normal transient stacking. Windows can be swapped either by dragging one onto another or with `Meta+Arrow` shortcuts. All state is in memory and is scoped per output and virtual desktop.

The script is a pure geometry manager. It does not use KWin's native tile tree. It computes rectangles from the panel-aware work area and writes `frameGeometry` directly. This keeps the four fixed layouts explicit and avoids coupling the script to KWin's evolving tiling API.

## 2. Goals and non-goals

### 2.1 Goals

- Tile eligible windows in the required 1/2/3/4 layout order.
- Enforce a maximum of four visible tiled windows per screen.
- Minimize the least recently focused window when a fifth eligible window opens.
- Restore the most recently minimized window when a visible tiled window closes.
- Keep dialogs and popups floating; never tile or count them.
- Swap two tiled windows by dragging one onto the other.
- Swap the active tiled window with its directional neighbor using `Meta+Arrow`.
- Keep independent tile state per screen and virtual desktop.
- Remain a zero-configuration, single-purpose script with no settings UI.
- Degrade safely when windows disappear, outputs change, or KWin overrides geometry.

### 2.2 Non-goals

- No support for X11 sessions or Plasma 5.
- No configurable layouts, gaps, or key bindings.
- No stacking or master/stack tiling modes.
- No persistence of tile state across KWin restarts or logins.
- No use of KWin's native tile tree, custom tile editor, or `rootTile` API.
- No support for sticky windows, panels, docks, tooltips, notifications, or other special windows.
- No animated tiling transitions beyond KWin's own maximize animation.
- No per-activity tile state. Activities are handled by filtering the current activity; state is keyed per desktop.

## 3. Requirements

### 3.1 Functional requirements

1. When one eligible window is visible on a screen and desktop, it is maximized with KWin's real maximize state.
2. When a second eligible window opens, the first becomes the left half and the second becomes the right half.
3. When a third eligible window opens, the first remains the left half, the second becomes the right top quarter, and the third becomes the right bottom quarter.
4. When a fourth eligible window opens, the layout becomes four equal quarters. Slot order is top left, top right, bottom right, bottom left. The fourth window therefore occupies the bottom left.
5. When a fifth or later eligible window opens while four are visible, the least recently focused visible tiled window is minimized. The new window takes that window's slot index. The layout remains at four windows.
6. When a visible tiled window closes, the most recently minimized tiled window on that screen and desktop is restored, unminimized, and placed into the closed window's slot. It becomes the most recently focused window.
7. When a visible tiled window closes and no minimized window exists, the remaining windows compact and retile for the lower count.
8. Dragging a tiled window and releasing it over another tiled window on the same screen and desktop swaps their slot indices. The dragged window stays active.
9. Releasing a dragged tiled window anywhere else returns it to its slot.
10. `Meta+Left`, `Meta+Right`, `Meta+Up`, and `Meta+Down` swap the active tiled window with the nearest tiled window in that direction. If no target exists, nothing happens.
11. Dialog, transient, and popup windows are not tiled, not counted, and not minimized by the tiler. They remain above their parent through KWin's normal transient handling.
12. State is independent per output and virtual desktop.
13. A window that becomes fullscreen keeps its slot but is not resized while fullscreen. It is retiled when fullscreen ends.
14. The script adopts existing windows when it is enabled, replaying them through the normal add path in stacking order.
15. A manual maximize of a tiled window while other windows are visible is reverted. The layout is re-applied, the window is unmaximized, and its slot geometry is restored.

### 3.2 Constraints

- Target KWin 6 scripting API on Wayland only.
- Use JavaScript KWin script packaging (`X-Plasma-API: javascript`).
- Use `frameGeometry` for geometry writes; `geometry` and `clientGeometry` are deprecated for this purpose.
- Use `workspace.clientArea(KWin.MaximizeArea, output, desktop)` so panels and struts are respected.
- No new dependencies, no build step, no settings module.
- Keep the runtime to one JavaScript file plus `metadata.json`.
- Fixed gap: 6 logical pixels. Each tile is inset by 3 pixels on every side.
- Maximum four visible tiled windows per `(output, desktop)`.

### 3.3 Acceptance criteria

- Opening one to four eligible windows produces exactly the specified layout on the window's output.
- A fifth window minimizes the least recently focused visible tiled window and takes its slot.
- Closing a visible window with a non-empty restore stack restores the most recently minimized window into the freed slot and activates it.
- Closing a visible window with an empty restore stack compacts the layout to the next lower count.
- Dialogs never appear in slot state and never alter layout.
- Drag-and-drop onto another tiled window swaps the two windows; any other drop returns the window to its slot.
- `Meta+Arrow` swaps with the correct directional neighbor in 2-, 3-, and 4-window layouts; it does nothing when no neighbor exists.
- Two monitors maintain independent layouts and restore stacks.
- Switching virtual desktops shows the layout for the target desktop without disturbing other desktops.
- Enabling the script with existing windows produces a valid layout and does not leave more than four visible tiled windows per screen.

## 4. Environment and API assumptions

The script targets KWin 6.x on Wayland. The following API surface is assumed to exist:

- `workspace.windowList()`
- `workspace.windowAdded`, `workspace.windowRemoved`, `workspace.windowActivated`
- `workspace.currentDesktop`, `workspace.currentDesktopChanged`, `workspace.desktops`
- `workspace.currentActivity`, `workspace.currentActivityChanged`
- `workspace.screens`, `workspace.screensChanged`
- `workspace.activeScreen`, `workspace.screenAt(pos)`, `workspace.cursorPos`
- `workspace.windowAt(pos, count)`
- `workspace.clientArea(KWin.MaximizeArea, output, desktop)`
- `registerShortcut(title, text, sequence, callback)`
- `Window.frameGeometry` (writable)
- `Window.output`, `Window.desktops`, `Window.activities`, `Window.onAllDesktops`
- `Window.normalWindow`, `Window.transient`, `Window.dialog`, `Window.popupWindow`, `Window.specialWindow`, `Window.managed`, `Window.deleted`
- `Window.minimized`, `Window.fullScreen`, `Window.tile`
- `Window.setMaximize(vertical, horizontal)`
- `Window.minimizedChanged`, `Window.fullScreenChanged`, `Window.desktopsChanged`, `Window.outputChanged`
- `Window.interactiveMoveResizeStarted`, `Window.interactiveMoveResizeFinished`
- `Output.name`, `Output.geometryChanged`
- Global `QTimer` (constructible KWin `ScriptTimer`) for one-shot deferral. KWin 6 JavaScript scripts do not expose a global `Qt`, so `Qt.callLater` is unavailable.
- Plain `{x, y, width, height}` objects assigned to `Window.frameGeometry`; KWin's `QJSValue`-to-`QRectF` converter reads those properties. `Qt.rect` is unavailable.

If a property or signal is missing on the installed KWin version, the script must fail soft: log the issue with `print()` and leave the affected window untiled rather than throwing out of a signal handler.

## 5. Architecture

### 5.1 Selected approach

A pure geometry tiler with explicit slot state. The script owns the layout and writes window geometry itself.

Alternatives considered:

- Native `rootTile` tree: KWin would handle geometry, padding, animations, and struts, but the API is newer, has changed across KWin 6 releases, and requires rebuilding tile trees when the window count changes. Custom tile layouts from the native tiling editor can also conflict. Rejected as higher risk for four fixed layouts.
- Hybrid: native tiles for layout plus script logic for LRU and swap. Rejected because it creates two sources of truth and makes restore/swap behaviour hard to reason about.

### 5.2 Package structure

```
quarter-tiler/
├── metadata.json
├── contents/
│   └── code/
│       └── main.js
├── tests/
│   └── layout.test.js
└── README.md
```

KWin's JavaScript API loads exactly one entry file and provides no `include` or module loader. `main.js` therefore contains both the pure layout functions and the KWin wiring. Pure functions are defined at the top; signal wiring, state, lifecycle, shortcuts, drag handling, and geometry application follow.

`main.js` ends with a dual bootstrap:

```js
if (typeof module !== "undefined" && module.exports) {
    module.exports = { slotRects, directionalTarget, chooseVictim, swapSlots };
} else {
    main();
}
```

Node imports the same file through `module.exports`. KWin has no `module`, so it runs `main()`. No build step, no bundler, and no second runtime file are required.

`tests/layout.test.js` runs with `node --test`. No test framework or package installation.

There is no settings UI, no QML, and no persisted configuration.

### 5.3 Runtime state

State is stored in a map keyed by `` `${output.name}|${desktop.id}` ``.

Each value has the following shape:

```js
{
    output: Output,          // output reference, used for clientArea
    desktop: VirtualDesktop, // desktop reference, used for clientArea
    slots: [],               // visible tiled windows, 0..4 entries, dense, slot order
    lru: [],                 // visible tiled windows, least recently focused first
    minimized: [],           // restore stack, most recently minimized last
    applying: false          // reentrancy guard for script-driven geometry changes
}
```

The stored `output` and `desktop` references let close, restore, and hotplug handlers re-apply a state without parsing the key. If either reference is stale or no longer appears in `workspace.screens` or `workspace.desktops`, the state is skipped until the hotplug handler re-keys it.

`slots` is dense. Slot index 0 always maps to the first rectangle in the current layout, index 1 to the second, and so on. `lru` contains exactly the same window objects as `slots`, in focus order. `minimized` contains tiled windows that were evicted by overflow or minimized manually; it is not part of the visible layout.

Window identity is the live `Window` object. Before acting on a stored window, the script checks that the object still appears in `workspace.windowList()` and is not `deleted`.

### 5.4 Event wiring

Workspace-level signals:

- `windowAdded`: defer one tick, then consider the window for tiling.
- `windowRemoved`: remove the window from all state and restore or compact.
- `windowActivated`: update LRU order.
- `currentDesktopChanged`: apply the state for the target desktop.
- `currentActivityChanged`: remove windows no longer on the activity and adopt windows newly present.
- `screensChanged`: purge stale state, re-adopt windows, retile.

Per-window signals, connected once for every eligible window as soon as it is seen, even when it is fullscreen or already minimized:

- `minimizedChanged`: distinguish manual minimize/restore from script eviction/restore.
- `fullScreenChanged`: add the window when it leaves fullscreen; retile when a slotted window leaves fullscreen.
- `desktopsChanged`: move the window between desktop states.
- `outputChanged`: move the window between output states.
- `interactiveMoveResizeStarted` and `interactiveMoveResizeFinished`: drag and resize handling.
- `maximizedChanged`: re-apply the layout if the user changes maximize state outside the script.

Deduplicate per-window connections with a `Set` of `internalId` values.

Per-output signals:

- `geometryChanged`: re-apply the layout for that output.

All handlers run inside `try/catch` and log failures with `print()`.

## 6. Layout specification

### 6.1 Work area

For a screen and desktop, compute:

```js
const area = workspace.clientArea(
    KWin.MaximizeArea,
    output,
    desktop
);
```

`MaximizeArea` excludes panels and other struts. If `area` is empty, skip the apply and log a warning.

### 6.2 Slot rectangles

Express each slot as a fraction of the work area:

| Count | Slot 0 | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | --- | --- | --- |
| 1 | full work area, real maximize | — | — | — |
| 2 | `(0, 0, 0.5, 1)` | `(0.5, 0, 0.5, 1)` | — | — |
| 3 | `(0, 0, 0.5, 1)` | `(0.5, 0, 0.5, 0.5)` | `(0.5, 0.5, 0.5, 0.5)` | — |
| 4 | `(0, 0, 0.5, 0.5)` | `(0.5, 0, 0.5, 0.5)` | `(0.5, 0.5, 0.5, 0.5)` | `(0, 0.5, 0.5, 0.5)` |

For count 4, slot 2 is bottom right and slot 3 is bottom left. The fourth opened window is appended at the end of `slots`, so it lands in slot 3, bottom left, as required.

For count 3, the second opened window is in slot 1 (right top) and the third is in slot 2 (right bottom), as required.

### 6.3 Gap

`GAP = 6` logical pixels. Each slot rectangle is inset by `GAP / 2 = 3` pixels on all four sides. Adjacent windows therefore have 6 pixels between them, and the screen edge has a 3-pixel margin. The gap is not configurable and does not apply to the maximized single-window state.

Round each fractional pixel value with `Math.round` before adding the work-area origin. Assign a plain object `{x, y, width, height}` to `Window.frameGeometry`; KWin's `QJSValue`-to-`QRectF` converter reads those properties.

### 6.4 Applying a layout

```
apply(state):
    if state.applying: return
    if state.output not in workspace.screens: return
    if state.desktop not in workspace.desktops: return
    state.applying = true
    try:
        prune state lists of dead or ineligible windows
        n = state.slots.length
        if n == 0:
            if state.minimized.length == 0: delete state
            return

        area = workspace.clientArea(KWin.MaximizeArea, state.output, state.desktop)
        if area.isEmpty(): log and return

        if n == 1:
            if not state.slots[0].fullScreen:
                state.slots[0].setMaximize(true, true)
        else:
            for each window in state.slots:
                window.setMaximize(false, false)
            rects = slotRects(n, area, GAP)
            for i in 0..n-1:
                if window.fullScreen: continue
                window.frameGeometry = fitToMinSize(rects[i], window)
            defer verifyOnce(state)
    finally:
        state.applying = false
```

`verifyOnce` runs on the next event-loop tick. It compares each window's `frameGeometry` with the target rectangle. If the difference is larger than one pixel on any side, it writes the target one more time and does not schedule another verification. This handles KWin restoring a window's pre-maximize geometry after `setMaximize(false, false)`.

Applying geometry must not trigger the script's own layout handlers. The `applying` guard covers writes and signal handlers that can run synchronously. A `defer()` helper backed by a one-shot global `QTimer` coalesces repeated apply requests for the same state.

If a target rectangle is smaller than a window's `minSize`, use the minimum size and anchor the window at the rectangle's top-left corner. The window may overlap the gap, but it must not be forced below its minimum.

### 6.5 Maximize state

The one-window state uses KWin's real maximize state via `setMaximize(true, true)`. The taskbar and titlebar reflect a maximized window. When a second window is added, every slotted window is unmaximized before quarter/half geometry is written.

A manual maximize while two or more tiled windows are visible is treated like any other manual geometry override. `maximizedChanged` schedules a layout apply. The apply calls `setMaximize(false, false)` for every slotted window and restores each window's slot geometry. The user cannot leave a tiled window maximized while other tiled windows are present. With one tiled window, a manual unmaximize is likewise reverted to the maximized state on the next apply.

## 7. Window lifecycle

### 7.1 Eligibility

A window is eligible for tiling only when all of the following hold:

```js
w.normalWindow &&
w.managed &&
!w.deleted &&
!w.transient &&
!w.dialog &&
!w.popupWindow &&
!w.specialWindow &&
!w.onAllDesktops
```

This excludes dialogs, transient popups, utility windows, panels, menus, tooltips, notifications, sticky windows, and special windows. Windows with a parent are excluded through `transient`, `dialog`, and `popupWindow` checks.

If an adopted window has a non-null `w.tile`, the script attempts `w.tile = null` to detach it from KWin's native tiling. If that fails, the window is left untiled and the failure is logged once per window. The apply path re-checks and clears `w.tile` before every geometry write and skips that window if detach fails.

A window that is already minimized when it first appears is not given a slot. It is pushed onto the restore stack and can join the layout when restored.

### 7.2 Adding a window

`windowAdded` is deferred with `defer()` so KWin has assigned the window's output and desktop.

```
addWindow(w):
    if not eligible(w): return
    connectWindowSignalsOnce(w)
    if w is already in any state: return
    if w.fullScreen: return
    if w.activities.length > 0 && !w.activities.includes(workspace.currentActivity): return
    desktop = w.desktops.length ? w.desktops[0] : workspace.currentDesktop
    output = w.output || workspace.activeScreen
    if not output: defer and retry once
    state = stateFor(output, desktop)

    if w.minimized:
        state.minimized.push(w)
        return

    if state.slots.length < 4:
        state.slots.push(w)
        touch(state, w)
        apply(state)
        return

    victim = chooseVictim(state)
    index = state.slots.indexOf(victim)
    removeFromSlotsAndLru(state, victim)
    victim.minimized = true
    state.minimized.push(victim)

    state.slots.splice(index, 0, w)
    touch(state, w)
    apply(state)
```

When four windows are visible, inserting the new window at the victim's index preserves the positions of the other three windows. The new window does not always land in slot 3 in this case; it takes the freed slot. This rule is intentional and applies to both script-driven eviction and manual overflow.

### 7.3 Focus order and victim selection

`touch(state, w)` removes `w` from `state.lru` if present and appends it. The end of `lru` is the most recently focused window; the front is the least recently focused.

`windowActivated` updates focus order:

- Resolve the activated window to its root transient parent by following `transientFor` until no parent remains.
- Find the state that contains the root.
- If the root is in that state's `slots`, touch the root. Focusing a dialog therefore protects the parent application from eviction.
- Ignore windows that are not in any state.

`chooseVictim(state)` scans `state.lru` from the front and returns the first window that does not have a visible transient child. A visible transient child is any window in `workspace.windowList()` with `transientFor` equal to the candidate and `minimized === false`. This prevents minimizing a parent while its dialog is open. If every candidate has a visible child, the script falls back to `lru[0]`.

Fullscreen tiled windows are skipped as victims when any non-fullscreen candidate exists. If all candidates are fullscreen, the normal LRU fallback applies.

### 7.4 Closing a window

`windowRemoved` can fire after a window is already deleted, so the script locates state by searching all states for membership rather than reading the closed window's current output.

```
removeWindow(w):
    state = findStateContaining(w)
    if not state: return

    wasVisible = state.slots.includes(w)
    index = state.slots.indexOf(w)
    remove w from slots, lru, and minimized

    if wasVisible:
        if state.minimized.length > 0:
            restored = state.minimized.pop()
            restored.minimized = false
            state.slots.splice(index, 0, restored)
            touch(state, restored)
            workspace.activeWindow = restored
        apply(state)
    else:
        apply(state)
```

If the closed window was minimized, it is removed from the restore stack and nothing is restored. If the closed window was visible and the restore stack is non-empty, exactly one window is restored, so the visible count stays at four. If the stack is empty, the remaining windows compact into the next lower layout.

### 7.5 Manual minimize and restore

The script distinguishes manual actions from its own changes by ordering its internal mutations before setting `minimized`:

- Script eviction: remove from `slots` and `lru`, then set `minimized = true`, then push to `minimized`. The resulting signal handler sees the window is no longer in `slots` and does nothing.
- Script restore: pop from `minimized`, then set `minimized = false`, then insert into `slots`. The signal handler sees the window is no longer in `minimized` and does nothing.

Manual minimize of a visible tiled window removes it from `slots` and `lru`, pushes it onto `minimized`, and reflows the remaining windows. No window is automatically restored.

Manual restore of a minimized tiled window removes it from `minimized`, then adds it like a newly opened window. If four windows are visible, the least recently focused visible window is evicted first.

### 7.6 Fullscreen

A tiled window that becomes fullscreen keeps its slot, remains in `lru`, and is ignored by geometry writes while `fullScreen === true`. Other windows remain in their slots behind it. When fullscreen ends, the layout is re-applied.

A newly opened fullscreen window is not added to a tile set until it leaves fullscreen, because it is not a normal desktop tiling candidate while covering the screen.

### 7.7 Startup and reload

When the script loads, it enumerates eligible windows from `workspace.windowList()` on the current desktop and activity, orders them by ascending `stackingOrder`, and calls `addWindow` for each. The normal add path enforces the four-window maximum. Each window beyond four evicts the least recently stacked remaining window, so the four most recently stacked eligible windows stay visible and the older ones move to the restore stack.

This replay is also used after the script is re-enabled or reloaded. Enabling the script with more than four eligible windows therefore minimizes the least recently stacked windows. This behaviour is documented for users.

If a window cannot be adopted because its output or desktop is not available yet, the script retries once on the next tick and then leaves the window untiled.

## 8. Swapping

### 8.1 Shortcut registration

The script registers four global shortcuts:

```js
registerShortcut("Quarter Tiler: Swap Left",  "Swap window left",  "Meta+Left",  () => swapDirection(-1, 0));
registerShortcut("Quarter Tiler: Swap Right", "Swap window right", "Meta+Right", () => swapDirection(1, 0));
registerShortcut("Quarter Tiler: Swap Up",    "Swap window up",    "Meta+Up",    () => swapDirection(0, -1));
registerShortcut("Quarter Tiler: Swap Down",  "Swap window down",  "Meta+Down",  () => swapDirection(0, 1));
```

KWin already binds `Meta+Arrow` to quick tiling. The installation documentation tells the user to clear the built-in Quick Tile Left/Right/Top/Bottom shortcuts in System Settings and to disable drag-to-edge quick tiling. The script does not attempt to modify KWin's shortcut configuration itself.

If `registerShortcut` returns `false`, the script logs the failure. The user can then assign the four actions manually in the KWin shortcuts settings.

If a shortcut is active while a dialog is focused, the handler resolves the dialog to its root transient parent and swaps the parent. If the resolved window is not in a slot, the handler does nothing.

### 8.2 Directional target selection

Given the current layout rectangles and the active slot index, select a target as follows:

1. Compute the center of each slot rectangle.
2. For each other slot, compute the vector from the active center to the candidate center.
3. Keep candidates whose center lies strictly in the requested direction: left means `dx < 0`, right means `dx > 0`, up means `dy < 0`, down means `dy > 0`.
4. Score each candidate as `abs(primary axis delta) + 2 * abs(lateral axis delta)`.
5. Choose the lowest score. On a tie, choose the lower slot index.
6. If no candidate remains, do nothing.

This produces the expected neighbours:

- Two windows: left and right swap horizontally; up and down do nothing.
- Three windows: left half swaps with the right column; right-top and right-bottom swap vertically; pressing right from the right column does nothing. Pressing right from the left half resolves to right-top because of the lower-index tie-break.
- Four windows: all orthogonal quarter neighbours swap.

The active window is resolved through its transient parent first. A maximized single window has no target. A fullscreen window does not swap.

After a successful swap, the two entries in `slots` exchange positions and the layout is applied. If the root window was the active window, it stays active. If the shortcut was pressed while a dialog was focused, the dialog keeps focus and the script does not activate the root.

### 8.3 Drag-and-drop swap

Each adopted window gets `interactiveMoveResizeStarted` and `interactiveMoveResizeFinished` handlers.

On start, record whether the interaction is a move or a resize. The script reads `w.move` and `w.resize` during the interaction to distinguish the two. A resize always ends in a snap back.

On finish, defer one tick with `defer()` so KWin has completed its own move handling, then:

1. If the window is not in a slot, return.
2. If the window is fullscreen, return.
3. Read `pos = workspace.cursorPos`.
4. Resolve the destination output with `workspace.screenAt(pos) || w.output`.
5. Compare the destination output and desktop key with the state the dragged window belongs to.

Same output and desktop:

- Query `workspace.windowAt(pos, -1)` for all windows under the cursor, topmost first.
- Ignore the dragged window itself. Take the topmost remaining window.
- If that window is present in the same state's `slots` and is not fullscreen, it is the swap target.
- Swap the dragged and target indices in `slots`, apply the layout, and keep the dragged window active.
- If the topmost remaining window is a dialog, a non-tiled window, or absent, there is no target. Apply the layout to snap the dragged window back to its slot.

Different output:

- Remove the dragged window from the source state and reflow the source. Do not restore a minimized window into the freed source slot; only closing a window triggers a restore.
- Add the dragged window to the destination state using the normal add path. If the destination already has four visible windows, its LRU victim is minimized.
- Apply both layouts.

Drop over a dialog or a non-tiled window counts as no target, so the window snaps back.

### 8.4 Snap-back and native tiling interference

Any manual move or resize that is not a same-screen swap or a cross-screen move ends with the window returned to its slot. This includes dropping on empty space, dropping on a dialog, and releasing a resize.

KWin's drag-to-edge quick tiling can change a window's geometry before the script's `interactiveMoveResizeFinished` handler runs. The snap-back or swap is authoritative, so the script overrides that geometry. Users who want predictable behavior should disable drag-to-edge quick tiling alongside the built-in arrow shortcuts.

## 9. Multi-screen, desktops, and activities

### 9.1 Multi-screen

Each output has independent state. A new window joins the output it opens on. Overflow, restore, and swap never move windows between outputs except when the user drags one across.

When `screensChanged` fires:

- Remove windows that no longer appear in `workspace.windowList()`.
- Re-key states whose output name changed.
- Re-adopt eligible windows that are not in any state, using the normal add path.
- Re-apply every remaining state.

When an output's `geometryChanged` fires, re-apply that output's states. Panel or resolution changes therefore recompute all slot rectangles.

If the active output disappears, windows KWin migrates to a remaining output are adopted there. Their order follows the normal add path.

### 9.2 Virtual desktops

State is keyed by output name and virtual desktop ID. A window's desktop is taken from `w.desktops[0]` when present, otherwise from `workspace.currentDesktop`.

When `currentDesktopChanged` fires, the script adapts any untracked eligible windows on the target desktop through the normal add path, then applies the state for that desktop. It does not touch states belonging to other desktops. When a window's `desktopsChanged` signal fires, the script removes it from its old desktop state and adds it to the new one, reflowing both.

Plasma 6.7 introduced per-output virtual desktops. The design uses the window's own desktop, taken from `w.desktops[0]`, for its state. The global `workspace.currentDesktop` is only a fallback when the window reports no desktop. If per-output desktop switching leaves an untracked window on an output, the next `currentDesktopChanged` or `windowAdded` event adopts it.

A window on multiple virtual desktops but not on all desktops is assigned to the first desktop in its `desktops` array. Sticky windows are excluded by eligibility.

### 9.3 Activities

Activities are not a primary target of this design. The script filters windows to the current activity: a window is considered present when `w.activities` is empty or contains `workspace.currentActivity`.

On `currentActivityChanged`, windows that are no longer present are removed from the visible layout without being minimized, and windows newly present are adopted through the normal add path. Tile state remains keyed only by output and desktop. This means activity switching may reorder windows and may evict a window if the newly visible set exceeds four. This limitation is documented.

## 10. Dialogs, popups, and transient windows

Windows with parents are excluded from eligibility. The script never:

- resizes or moves them,
- adds them to `slots`, `lru`, or `minimized`,
- selects them as LRU victims,
- swaps them with `Meta+Arrow`.

KWin's normal transient handling keeps dialogs above their parent. The script does not set `keepAbove`, because that would pin dialogs above unrelated applications and persist after the dialog closes.

When a parent is chosen as an LRU victim, the victim selector skips it if it has a visible transient child. If every visible tiled window has a visible child, the selector falls back to the least recently focused window; its dialog will hide with it.

## 11. Edge cases and failure handling

- **Window deleted mid-handler:** check `w.deleted` and membership in `workspace.windowList()` before writing geometry.
- **Empty work area:** skip the apply and log. Do not write zero-sized geometry.
- **Minimum size larger than slot:** clamp to `minSize` and anchor top-left. Never force a window below its minimum.
- **Maximize restore race:** use the one-shot verification pass after unmaximizing.
- **Native tile attached:** attempt `w.tile = null`; if it fails, leave the window untiled and log.
- **Sticky window:** excluded by eligibility, left floating.
- **Already-minimized new window:** pushed to the restore stack, not given a slot.
- **Manual minimize of all visible windows:** the state keeps its restore stack and visible count becomes zero. The state entry is deleted only when both `slots` and `minimized` are empty. Restoring a window later produces a one-window maximized layout.
- **Close of a minimized window:** remove from the restore stack; do not restore another.
- **Restore stack with windows from an output that disappeared:** prune dead windows during apply.
- **Duplicate adoption:** `addWindow` checks all states before inserting.
- **Reentrancy:** `applying` guard plus `defer()` coalescing. State-mutating signal handlers that fire during an apply schedule a follow-up apply instead of mutating slots, and the apply loop iterates a snapshot of `slots`. Geometry writes never recursively schedule unbounded applies.
- **Signal handler exception:** catch, log with `print()`, and continue. A single bad window must not disable the whole script.
- **Missing API:** feature-detect optional signals and properties at startup; log a single warning and disable the affected feature rather than throwing.

## 12. Testing

### 12.1 Automated pure-function tests

`tests/layout.test.js` and `tests/runtime.test.js` use Node's built-in `node:test` and `node:assert`. The layout tests import `contents/code/main.js` through the `module.exports` guard; importing the file must not execute `main()` under Node. The runtime test reads the source text and asserts that it contains no global `Qt.` usage and uses `new QTimer()` for deferral.

Coverage:

- Slot rectangles for n = 1, 2, 3, and 4 relative to a work area.
- Gap inset: every non-maximized rectangle is inset by 3 pixels per side.
- Slot order: n = 3 gives left, right top, right bottom; n = 4 gives top left, top right, bottom right, bottom left.
- Directional target selection for 2, 3, and 4 windows, including tie-breaks and no-target cases.
- Swap index calculation.
- LRU victim selection, including skipping parents with visible dialogs, same-output/desktop/activity blocking, and fallback when all are blocked.
- Clamp-to-minimum-size behaviour.
- Runtime source contains no `Qt.` global and uses a constructible `QTimer`.

Run with:

```bash
node --test tests/layout.test.js tests/runtime.test.js
```

No KWin process or test framework is required for these tests.

### 12.2 Manual KWin test matrix

Run on Plasma 6 Wayland with the script installed and enabled. Check journal output with:

```bash
journalctl -f _COMM=kwin_wayland
```

Cases:

1. Open windows one at a time from one to four. Verify each layout and slot order.
2. Open a fifth window. Verify the least recently focused window is minimized and the new window takes its slot.
3. Focus windows in a non-sequential order, then open a fifth. Verify the actual LRU window is minimized.
4. Close a visible window with a non-empty restore stack. Verify the most recently minimized window is restored into the freed slot and activated.
5. Close a visible window with an empty restore stack. Verify compaction to the lower layout.
6. Manually minimize a tiled window, then open a new one. Verify no unexpected restore.
7. Manually restore a minimized window while four are visible. Verify LRU eviction.
8. Drag a window onto another tiled window. Verify the swap.
9. Drag a window onto empty space, a dialog, and a non-tiled window. Verify snap-back.
10. Resize a tiled window. Verify snap-back.
11. Drag a window to another monitor. Verify source reflow and destination add or eviction.
12. Press each `Meta+Arrow` in 2-, 3-, and 4-window layouts. Verify correct neighbour or no-op.
13. Open a dialog over a tiled parent. Verify no layout change and no counting.
14. Open a fifth window while a tiled parent has an open dialog. Verify the parent with the dialog is not chosen.
15. Toggle fullscreen on a tiled window and exit. Verify slot retention and retiling.
16. Move or resize a panel, then verify the layout recomputes.
17. Test two monitors with independent layouts.
18. Test two virtual desktops and switch between them.
19. Disable and re-enable the script with existing windows. Verify replay and the four-window cap.
20. Remove and reconnect a monitor while windows are tiled. Verify recovery.
21. Manually maximize a tiled window while two or more are visible. Verify it is unmaximized and returned to its slot. With one tiled window, unmaximize it manually and verify it is maximized again.

### 12.3 Early spike checks

Before building the full script, verify on the target Plasma version:

- `interactiveMoveResizeStarted` and `interactiveMoveResizeFinished` fire for titlebar drags on Wayland.
- `workspace.windowAt(pos, -1)` returns the expected tiled window under the cursor during and after a drag.
- `registerShortcut` accepts `Meta+Arrow` after the built-in quick-tile shortcuts are cleared.
- Writing `frameGeometry` immediately after `setMaximize(false, false)` sticks, or the verification pass is required.
- `w.tile = null` is accepted on a KWin-native tiled window.

If drag signals do not fire reliably, the drag-swap feature is disabled and the shortcut-swap feature remains. This is the only planned feature fallback.

## 13. Packaging and installation

`metadata.json`:

```json
{
    "KPlugin": {
        "Name": "Quarter Tiler",
        "Description": "Automatic quarter tiling for up to four windows per screen",
        "Icon": "preferences-system-windows",
        "Id": "quarter-tiler",
        "Version": "1.0.0",
        "License": "GPL-3.0-or-later"
    },
    "X-Plasma-API": "javascript",
    "X-Plasma-MainScript": "code/main.js",
    "KPackageStructure": "KWin/Script"
}
```

Install and enable:

```bash
kpackagetool6 --type=KWin/Script -i ./quarter-tiler
kwriteconfig6 --file kwinrc --group Plugins --key quarter-tilerEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

After changing code, reinstall or reload the script from System Settings, then restart the KWin scripting runtime or re-enable the script.

The installation notes must state:

- Clear KWin's built-in Quick Tile Left/Right/Top/Bottom shortcuts.
- Disable drag-to-edge quick tiling.
- Enabling the script with more than four eligible windows minimizes older windows during replay.

## 14. Known limitations and risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `interactiveMoveResizeFinished` unreliable on some Wayland/KWin versions | Drag swap does not work | Early spike; fall back to shortcut-only swapping |
| Built-in `Meta+Arrow` shortcuts conflict | Arrow swap does not fire | Installation instructions clear built-in shortcuts |
| KWin restores pre-maximize geometry after unmaximizing | Tiles briefly or permanently wrong | One-shot verification pass |
| KWin drag-to-edge quick tiling | Window behaves unexpectedly on drop | Snap-back is authoritative; document disabling edge tiling |
| Enabling with more than four windows | Older windows minimized | Documented; replay follows the required overflow rule |
| Native tile tree still attached | KWin and script fight over geometry | Detach with `w.tile = null`; skip and log on failure |
| Minimum-size windows | Gaps or slot overlap | Clamp to `minSize`, anchor top-left |
| Activities | Reordering or eviction on activity switch | Documented limitation; state remains per desktop |
| No automated integration tests | Signal behavior regressions | Manual test matrix plus pure-function tests |
| KWin 6.x API churn | Property or signal missing | Feature detection, soft failure, single log warning |

## 15. Out of scope

- Configurable gap, padding, margins, or layout ratios.
- More than four tiled windows per screen.
- Stacking, master/stack, scrolling, or dynamic tiling.
- Window rules, per-application exceptions, or ignore lists.
- Persisting layout across sessions, KWin restarts, or login.
- Per-activity independent layouts.
- X11 support, Plasma 5 support, or non-KWin compositors.
- Visual indicators, overlays, or tiles previews.
- Animating swaps or layout changes.
- Using KWin's native tiling tree or tile editor.

## 16. Implementation outline

This is an implementation outline, not a task plan. The implementation plan will be written separately.

1. Implement pure layout functions in `main.js` and `tests/layout.test.js`.
2. Implement state map, eligibility, add/close/LRU/restore in `main.js`.
3. Implement geometry application with maximize handling, gap, minimum-size clamp, and verification pass.
4. Implement shortcut registration and directional swap.
5. Implement drag start/finish handling, same-screen swap, and cross-screen moves.
6. Implement multi-screen, desktop, activity, and fullscreen handling.
7. Add startup replay, error guards, and logging.
8. Add `metadata.json`, installation notes, and run the manual test matrix.

## 17. Decisions recorded

- Target is Plasma 6 Wayland only.
- Only normal, non-transient windows are tiled.
- Tile state is independent per screen and virtual desktop.
- A restored window takes the freed slot; the restore stack is LIFO.
- Drag swap is same-screen only; cross-screen drags are move-and-retile.
- Manual moves and resizes snap back.
- `Meta+Arrow` shortcuts are used; users clear KWin's built-in bindings.
- One-window state uses real maximize.
- Fixed 6-pixel gap, no configuration.
- Pure geometry approach; native tile tree rejected.
- No persistence across restarts.
