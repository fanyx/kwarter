# Kwarter

Automatic quarter tiling for KWin 6. Kwarter keeps up to four normal application windows
tiled on each screen. Opening an additional window minimizes the least recently used
window and puts it on a stack. When a slot opens up again due closing a window or moving
it off to another screen, Kwarter automatically resumes previously minimized windows.

The runtime that KWin loads is the single generated file `contents/code/main.js`.
Its source lives in focused CommonJS modules under `src/`, and `tools/build.js` bundles
them into that runtime file. KWin cannot load included or required files, so the bundle
is the only runtime artifact. The bundle is generated, untracked, and rebuilt by
`just build`.

## Requirements

- KWin 6.x (Wayland)
- `kpackagetool6` and `kwriteconfig6`
- build: Node.js 18

## Source layout

```
src/
├── index.js              entry point: loads bootstrap and calls main()
├── bootstrap.js          wires signals, shortcuts, and replay
├── shortcuts.js          registers Meta+Arrow actions
├── core/
│   ├── layout.js         slot math and pure helpers
│   ├── registry.js       mutable connection and warning registries
│   ├── windows.js        window identity, output, desktop, eligibility
│   ├── timing.js         QTimer-based deferral
│   ├── state.js          per-output/desktop slot, LRU, and restore state
│   ├── schedule.js       coalesced apply scheduling
│   └── apply.js          geometry and maximize application
├── actions/
│   ├── lifecycle.js      add, remove, and replay windows
│   ├── swap.js           directional shortcut swap
│   └── drag.js           drag-start, drop, and snap-back handling
└── signals/
    ├── window.js         per-window signal handlers
    └── workspace.js      workspace, output, dock, desktop, activity handlers
tools/build.js            zero-dependency CommonJS bundler
```

## Install

Using `just`:

```bash
$ just install
```

Builds and installs the script using `kpackagetool6` and configures it using
`kwriteconfig6`.

If the script was previously installed, use `just upgrade` to overwrite or upgrade the
code.

## Clear KWin's built-in Quick Tile shortcuts

KWin binds `Meta+Left`, `Meta+Right`, `Meta+Up`, and `Meta+Down` to its own Quick Tile
actions. `Kwarter` uses the same keys for swapping, so clear the built-in bindings first:

1. Open **System Settings > Keyboard > Shortcuts**.
1. Search for **Quick Tile** and unbind the default shortcuts.

The script registers these four actions:

- **Kwarter: Swap Left** - `Meta+Left`
- **Kwarter: Swap Right** - `Meta+Right`
- **Kwarter: Swap Up** - `Meta+Up`
- **Kwarter: Swap Down** - `Meta+Down`

Assign or Re-assign the shortcuts manually by searching for `Kwarter` in Shortcuts.

## Disable drag-to-edge quick tiling

KWin's drag-to-edge quick tiling fights the tiler: it can move or maximize a window
before Kwarter's drop handler runs. Turn it off:

1. Open **System Settings > Display & Monitor > Screen Edges**
1. Untick `Maximize` and `Tile` behaviours.

## Layouts

The layout follows a fixed growth order. Slot order is top left, top right, bottom
right, bottom left.

| Windows | Layout                                         |
| ------- | ---------------------------------------------- |
| 1       | Full work area, real KWin maximize             |
| 2       | Left/right split                               |
| 3       | Left half, right top/bottom split              |
| 4       | Top left, top right, bottom right, bottom left |

The gap is fixed at 6 logical pixels: each tile is inset by 3 pixels, so adjacent
windows have a 6-pixel gap and screen edges have a 3-pixel margin. The one-window
maximized state has no gap.

## Overflow and restore

- **Additional window:** when four tiled windows are visible and another eligible window
    opens, the least recently focused visible window is minimized. The new window takes
    the freed slot, so the other three do not move.
- **Close a visible window:** the most recently minimized window is restored into the
    freed slot and activated.
- **Close with an empty restore stack:** the remaining windows compact to the next
    lower layout.
- **Manual minimize:** the window moves to the restore stack and the visible windows
    reflow. No window is automatically restored.
- **Manual restore while four are visible:** the least recently focused visible window
    is evicted first.
- **Parent with an open dialog:** the parent is skipped as an eviction victim while its
    dialog is visible. If every visible tiled window has a visible dialog, the selector
    falls back to the least recently focused window.

Windows that are already minimized when the script adopts them go to the restore stack
and join the layout only when restored.

## Dragging and shortcut swapping

- **Drag swap:** drag one tiled window and drop it over another tiled window on the same
    output and desktop. The two windows exchange slots, and the dragged window stays
    active.
- **Drop anywhere else:** dropping on empty space, a dialog, or a non-tiled window snaps
    the dragged window back to its slot.
- **Resize:** resizing a tiled window also snaps back to its slot.
- **Cross-screen drag:** dragging a window to another output removes it from the source
    layout and adds it to the destination layout. If the destination already has four
    windows, its least recently focused window is minimized. A cross-screen drag does
    not restore a minimized window into the freed source slot; only closing a window
    does that.
- **Arrow swap:** `Meta+Left/Right/Up/Down` swaps the active tiled window with its
    nearest neighbor in that direction. If there is no neighbor, nothing happens.
    The layouts produce these neighbors:
    - Two windows: left and right swap; up and down do nothing.
    - Three windows: the left half and the right column swap horizontally;
        right top and right bottom swap vertically;
        right from the right column does nothing.
    - Four windows: all orthogonal quarter neighbors swap.

## License

WTFPL
