// FILE_CONTEXT: "context-1c4bdbbb-72c8-4858-8268-ece7386200ac"

import type { WidgetPlacement, WidgetSize } from "./dashboard-model.ts";

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const normalizeSize = (size: WidgetSize, gridColumns: number): WidgetSize => {
    const safeColumns = Math.max(1, gridColumns);
    return {
        w: clamp(size.w, 1, safeColumns),
        h: Math.max(1, size.h)
    };
};

const normalizePlacement = (
    placement: WidgetPlacement,
    gridColumns: number,
    size: WidgetSize
): WidgetPlacement => {
    const safeColumns = Math.max(1, gridColumns);
    const maxX = Math.max(0, safeColumns - size.w);
    return {
        x: clamp(placement.x, 0, maxX),
        y: Math.max(0, placement.y),
        w: size.w,
        h: size.h
    };
};

const overlaps = (left: WidgetPlacement, right: WidgetPlacement): boolean => {
    const leftRight = left.x + left.w;
    const rightRight = right.x + right.w;
    const leftBottom = left.y + left.h;
    const rightBottom = right.y + right.h;

    const separatedHorizontally = leftRight <= right.x || rightRight <= left.x;
    const separatedVertically = leftBottom <= right.y || rightBottom <= left.y;

    return !(separatedHorizontally || separatedVertically);
};

const collides = (candidate: WidgetPlacement, existing: WidgetPlacement[]): boolean =>
    existing.some((placement) => overlaps(candidate, placement));

export const computeNextPlacement = (
    existing: WidgetPlacement[],
    size: WidgetSize,
    gridColumns: number,
    placementOverride?: Partial<WidgetPlacement>
): WidgetPlacement => {
    const maxExistingBottom = existing.reduce(
        (currentMax, placement) => Math.max(currentMax, placement.y + placement.h),
        0
    );
    const baseSize: WidgetSize = {
        w: placementOverride?.w ?? size.w,
        h: placementOverride?.h ?? size.h
    };
    const normalizedSize = normalizeSize(baseSize, gridColumns);
    const basePlacement: WidgetPlacement = {
        x: placementOverride?.x ?? 0,
        y: placementOverride?.y ?? maxExistingBottom,
        w: normalizedSize.w,
        h: normalizedSize.h
    };
    const candidate = normalizePlacement(basePlacement, gridColumns, normalizedSize);
    if (!collides(candidate, existing)) {
        return candidate;
    }

    const safeColumns = Math.max(1, gridColumns);
    const maxX = Math.max(0, safeColumns - normalizedSize.w);
    const maxRows = Math.max(maxExistingBottom, candidate.y) + normalizedSize.h + 1;

    for (let y = candidate.y; y <= maxRows; y += 1) {
        const xStart = y === candidate.y ? candidate.x : 0;
        for (let x = xStart; x <= maxX; x += 1) {
            const candidate: WidgetPlacement = {
                x,
                y,
                w: normalizedSize.w,
                h: normalizedSize.h
            };

            if (!collides(candidate, existing)) {
                return candidate;
            }
        }
    }

    return {
        x: 0,
        y: maxRows,
        w: normalizedSize.w,
        h: normalizedSize.h
    };
};
