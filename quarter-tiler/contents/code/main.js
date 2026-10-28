const GAP = 6;
const MAX_WINDOWS = 4;

const SLOT_FRACTIONS = {
    2: [
        [0, 0, 0.5, 1],
        [0.5, 0, 0.5, 1],
    ],
    3: [
        [0, 0, 0.5, 1],
        [0.5, 0, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
    ],
    4: [
        [0, 0, 0.5, 0.5],
        [0.5, 0, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
        [0, 0.5, 0.5, 0.5],
    ],
};

function slotRects(count, area, gap) {
    if (count === 1) {
        return [{ x: area.x, y: area.y, width: area.width, height: area.height }];
    }

    const fractions = SLOT_FRACTIONS[count];
    if (!fractions) {
        return [];
    }

    const inset = Math.round(gap / 2);
    return fractions.map(([fx, fy, fw, fh]) => ({
        x: Math.round(area.x + fx * area.width) + inset,
        y: Math.round(area.y + fy * area.height) + inset,
        width: Math.round(fw * area.width) - 2 * inset,
        height: Math.round(fh * area.height) - 2 * inset,
    }));
}

function directionalTarget(rects, activeIndex, dx, dy) {
    if (!Array.isArray(rects)) {
        return -1;
    }
    if (dx === 0 && dy === 0) {
        return -1;
    }
    if (activeIndex < 0 || activeIndex >= rects.length) {
        return -1;
    }

    const active = rects[activeIndex];
    const activeX = active.x + active.width / 2;
    const activeY = active.y + active.height / 2;

    let best = -1;
    let bestScore = Infinity;

    for (let i = 0; i < rects.length; i++) {
        if (i === activeIndex) {
            continue;
        }

        const candidate = rects[i];
        const vx = candidate.x + candidate.width / 2 - activeX;
        const vy = candidate.y + candidate.height / 2 - activeY;

        if (dx < 0 && vx >= 0) continue;
        if (dx > 0 && vx <= 0) continue;
        if (dy < 0 && vy >= 0) continue;
        if (dy > 0 && vy <= 0) continue;

        const primary = dx !== 0 ? vx : vy;
        const lateral = dx !== 0 ? vy : vx;
        const score = Math.abs(primary) + 2 * Math.abs(lateral);

        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }

    return best;
}

function chooseVictimIndex(lruIds, blockedIds) {
    if (lruIds.length === 0) {
        return -1;
    }
    for (let i = 0; i < lruIds.length; i++) {
        if (!blockedIds.includes(lruIds[i])) {
            return i;
        }
    }
    return 0;
}

function swapSlots(slots, a, b) {
    const copy = slots.slice();
    const tmp = copy[a];
    copy[a] = copy[b];
    copy[b] = tmp;
    return copy;
}

function fitToMinSize(rect, minSize) {
    return {
        x: rect.x,
        y: rect.y,
        width: Math.max(rect.width, minSize.width),
        height: Math.max(rect.height, minSize.height),
    };
}

function rectsClose(a, b, tolerance) {
    return (
        Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance
    );
}

function eligible(w) {
    return Boolean(
        w &&
        w.normalWindow &&
        w.managed &&
        !w.deleted &&
        !w.transient &&
        !w.dialog &&
        !w.popupWindow &&
        !w.specialWindow &&
        !w.onAllDesktops
    );
}

function stateKey(output, desktop) {
    return `${output.name}|${desktop.id}`;
}

function resolveRoot(w) {
    let current = w;
    const visited = new Set();
    while (current && current.transientFor) {
        const id = current.internalId !== undefined ? current.internalId : current;
        if (visited.has(id)) {
            break;
        }
        visited.add(id);
        current = current.transientFor;
    }
    return current;
}

function main() {
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        GAP,
        MAX_WINDOWS,
        slotRects,
        directionalTarget,
        chooseVictimIndex,
        swapSlots,
        fitToMinSize,
        rectsClose,
        eligible,
        stateKey,
        resolveRoot,
        main,
    };
} else {
    main();
}
