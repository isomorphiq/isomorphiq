import type { WidgetPlacement, WidgetSize } from "./dashboard-model.ts";

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
    gridColumns: number
): WidgetPlacement => {
    const maxExistingBottom = existing.reduce(
        (currentMax, placement) => Math.max(currentMax, placement.y + placement.h),
        0
    );
    const candidateColumns = Math.max(gridColumns, size.w);
    const maxRows = maxExistingBottom + size.h + 1;

    for (let y = 0; y <= maxRows; y += 1) {
        for (let x = 0; x <= candidateColumns - size.w; x += 1) {
            const candidate: WidgetPlacement = {
                x,
                y,
                w: size.w,
                h: size.h
            };

            if (!collides(candidate, existing)) {
                return candidate;
            }
        }
    }

    return {
        x: 0,
        y: maxRows,
        w: size.w,
        h: size.h
    };
};
