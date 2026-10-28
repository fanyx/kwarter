# Quarter Tiler

Automatic quarter tiling for KWin 6. Quarter Tiler keeps up to four normal
application windows tiled on each screen. It is a zero-configuration script:
there is no settings page, no config file, and no build step.

## Requirements

- KDE Plasma 6 on a Wayland session.
- KWin 6.x.
- `kpackagetool6` and `kwriteconfig6` (part of Plasma).
- `qdbus6` (part of Qt 6 tools) to reload KWin's configuration.

X11 sessions and Plasma 5 are not supported. Tile state is held in memory and
does not survive a KWin restart or login.

## Install

From the repository root:

```bash
kpackagetool6 --type=KWin/Script -i ./quarter-tiler
kwriteconfig6 --file kwinrc --group Plugins --key quarter-tilerEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

If the script is already installed and you want to replace it, use
`-u` (upgrade) instead of `-i`:

```bash
kpackagetool6 --type=KWin/Script -u ./quarter-tiler
```

After changing the code, reinstall the package, then re-enable the script or
restart the KWin scripting runtime so the new code is loaded.

## Enable the script

The `kwriteconfig6` command above enables the script. You can also enable it
in System Settings:

1. Open **System Settings > Window Management > KWin Scripts**.
2. Find **Quarter Tiler** in the list.
3. Tick its checkbox and click **Apply**.

Disabling and re-enabling the script replays the existing windows through the
normal add path. If more than four eligible windows are open, the oldest
(stacking order) windows are minimized during replay.

## Clear KWin's built-in Quick Tile shortcuts

KWin binds `Meta+Left`, `Meta+Right`, `Meta+Up`, and `Meta+Down` to its own
Quick Tile actions. Quarter Tiler uses the same keys for swapping, so clear
the built-in bindings first:

1. Open **System Settings > Keyboard > Shortcuts**.
2. Search for **Quick Tile Left**, **Quick Tile Right**, **Quick Tile Top**,
   and **Quick Tile Bottom** (under **KWin**).
3. Clear each shortcut. You can also remove the four bindings by selecting
   each action and pressing the clear button.

The script registers these four actions:

- **Quarter Tiler: Swap Left** - `Meta+Left`
- **Quarter Tiler: Swap Right** - `Meta+Right`
- **Quarter Tiler: Swap Up** - `Meta+Up`
- **Quarter Tiler: Swap Down** - `Meta+Down`

If a shortcut fails to register (for example because another action already
owns the key), the script logs the failure. Assign the action manually under
**System Settings > Keyboard > Shortcuts > KWin**.

## Disable drag-to-edge quick tiling

KWin's drag-to-edge quick tiling fights the tiler: it can move or maximize a
window before Quarter Tiler's drop handler runs. Turn it off:

1. Open **System Settings > Window Management > Window Behavior > Moving**.
2. Set **Drag windows to screen edges to tile** (or the equivalent quick
   tiling option) to **Disabled** / **No**.

Quarter Tiler treats its own snap-back and swap as authoritative, so edge
tiling does not corrupt the layout, but disabling it gives predictable drag
behavior.

## Layouts

The layout follows a fixed growth order. Slot order is top left, top right,
bottom right, bottom left.

| Windows | Layout |
| --- | --- |
| 1 | Full work area, real KWin maximize |
| 2 | Left half, right half |
| 3 | Left half, right top quarter, right bottom quarter |
| 4 | Top left, top right, bottom right, bottom left |

The gap is fixed at 6 logical pixels: each tile is inset by 3 pixels, so
adjacent windows have a 6-pixel gap and screen edges have a 3-pixel margin.
The one-window maximized state has no gap.

The work area comes from KWin's maximize area for the window's output and
virtual desktop, so panels and struts are respected.

## Overflow and restore

- **Fifth window:** when four tiled windows are visible and another eligible
  window opens, the least recently focused visible window is minimized. The
  new window takes the freed slot, so the other three do not move.
- **Close a visible window:** the most recently minimized window is restored
  into the freed slot and activated.
- **Close with an empty restore stack:** the remaining windows compact to the
  next lower layout.
- **Manual minimize:** the window moves to the restore stack and the visible
  windows reflow. No window is automatically restored.
- **Manual restore while four are visible:** the least recently focused
  visible window is evicted first.
- **Parent with an open dialog:** the parent is skipped as an eviction victim
  while its dialog is visible. If every visible tiled window has a visible
  dialog, the selector falls back to the least recently focused window.

Windows that are already minimized when the script adopts them go to the
restore stack and join the layout only when restored.

## Dragging and shortcut swapping

- **Drag swap:** drag one tiled window and drop it over another tiled window
  on the same output and desktop. The two windows exchange slots, and the
  dragged window stays active.
- **Drop anywhere else:** dropping on empty space, a dialog, or a non-tiled
  window snaps the dragged window back to its slot.
- **Resize:** resizing a tiled window also snaps back to its slot.
- **Cross-screen drag:** dragging a window to another output removes it from
  the source layout and adds it to the destination layout. If the destination
  already has four windows, its least recently focused window is minimized.
  A cross-screen drag does not restore a minimized window into the freed
  source slot; only closing a window does that.
- **Arrow swap:** `Meta+Left/Right/Up/Down` swaps the active tiled window with
  its nearest neighbor in that direction. If there is no neighbor, nothing
  happens. The layouts produce these neighbors:
  - Two windows: left and right swap; up and down do nothing.
  - Three windows: the left half and the right column swap horizontally;
    right top and right bottom swap vertically; right from the right column
    does nothing.
  - Four windows: all orthogonal quarter neighbors swap.

Dialog focus does not break swapping: the script resolves a focused dialog to
its root parent and swaps the parent. The dialog keeps focus.

## Manual maximize revert

With two or more tiled windows visible, manually maximizing a tiled window is
reverted on the next layout pass: the window is unmaximized and returned to
its slot. With one tiled window, manually unmaximizing it is likewise reverted
to the maximized state. This keeps the layout deterministic.

## Fullscreen

A tiled window that becomes fullscreen keeps its slot and is not resized while
fullscreen. It is retiled when fullscreen ends. A newly opened fullscreen
window is not tiled until it leaves fullscreen.

## Known limitations

- Wayland and Plasma 6 only; no X11 or Plasma 5 support.
- Maximum four visible tiled windows per output and virtual desktop.
- Tile state is not persisted across KWin restarts or logins.
- No settings UI: the gap, layouts, and key bindings are fixed.
- Drag swap depends on KWin emitting `interactiveMoveResizeStarted` and
  `interactiveMoveResizeFinished`. If a KWin version does not emit them
  reliably, drag swap does not work; arrow swapping still does.
- Drag-to-edge quick tiling must be disabled for predictable drag behavior.
- Activities are filtered, not modelled: switching activities can reorder
  windows or evict one if the newly visible set exceeds four. State remains
  keyed per output and virtual desktop.
- Sticky windows, panels, docks, tooltips, notifications, dialogs, popups,
  and other transient or special windows are never tiled or counted.
- Windows smaller than their minimum size are clamped and may overlap the gap.
- Enabling or re-enabling the script with more than four eligible windows
  minimizes the oldest windows during replay.
- No automated integration tests: signal behavior is covered by the manual
  matrix below plus pure-function tests.

## Tests

The pure layout and eligibility functions are tested with Node's built-in test
runner. No KWin session and no packages are required.

From the repository root:

```bash
node --test quarter-tiler/tests/layout.test.js
```

Optional syntax check:

```bash
node --check quarter-tiler/contents/code/main.js
```

To follow the installed script's log output:

```bash
journalctl -f _COMM=kwin_wayland
```

## Manual test matrix

Run these on Plasma 6 Wayland with the script installed and enabled. Use the
layout from the table above and record the result of each case.

1. **1 to 4 layout growth:** open windows one at a time from one to four.
   Verify each layout and slot order (TL, TR, BR, BL).
2. **5th window LRU eviction:** open a fifth window. Verify the least recently
   focused window is minimized and the new window takes its slot.
3. **Non-sequential focus LRU:** focus windows in a non-sequential order, then
   open a fifth. Verify the actual least recently focused window is minimized.
4. **Close restore:** close a visible window with a non-empty restore stack.
   Verify the most recently minimized window is restored into the freed slot
   and activated.
5. **Close and compact:** close a visible window with an empty restore stack.
   Verify compaction to the next lower layout.
6. **Manual minimize:** manually minimize a tiled window, then open a new one.
   Verify no unexpected restore and correct reflow.
7. **Manual restore:** manually restore a minimized window while four are
   visible. Verify the least recently focused window is evicted.
8. **Drag swap:** drag a window onto another tiled window. Verify the swap and
   that the dragged window stays active.
9. **Drop empty / dialog / non-tiled:** drag a window onto empty space, onto a
   dialog, and onto a non-tiled window. Verify snap-back in each case.
10. **Resize snap-back:** resize a tiled window. Verify it snaps back to its
    slot.
11. **Cross-screen drag:** drag a window to another monitor. Verify source
    reflow and destination add or eviction.
12. **All arrow swaps:** press each `Meta+Arrow` in 2-, 3-, and 4-window
    layouts. Verify the correct neighbor or a no-op.
13. **Dialog spawn:** open a dialog over a tiled parent. Verify no layout
    change and no counting of the dialog.
14. **Parent-with-dialog LRU protection:** open a fifth window while a tiled
    parent has an open dialog. Verify the parent with the dialog is not chosen
    as the victim.
15. **Fullscreen toggle:** toggle fullscreen on a tiled window and exit.
    Verify slot retention and retiling.
16. **Panel move:** move or resize a panel, then verify the layout recomputes.
17. **Two monitors:** verify independent layouts and restore stacks.
18. **Two virtual desktops:** verify independent layouts and switching between
    desktops does not disturb the other desktop.
19. **Disable / re-enable replay:** disable and re-enable the script with
    existing windows. Verify replay and the four-window cap (oldest windows
    minimized).
20. **Monitor reconnect:** remove and reconnect a monitor while windows are
    tiled. Verify recovery.
21. **Manual maximize revert:** manually maximize a tiled window while two or
    more are visible. Verify it is unmaximized and returned to its slot. With
    one tiled window, unmaximize it manually and verify it is maximized again.

## License

GPL-3.0-or-later.
