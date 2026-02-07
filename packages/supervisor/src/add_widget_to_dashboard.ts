// FILE_CONTEXT: "context-0af8fea0-7cb3-4b2f-8936-6367b2163275"

export type WidgetPlacement = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type WidgetDefinition = {
    id: string;
    title: string;
    defaultSize: {
        w: number;
        h: number;
    };
};

export type DashboardWidget = {
    instanceId: string;
    widgetId: string;
    title: string;
    position: WidgetPlacement;
    addedAt: number;
};

export type DashboardGrid = {
    columns: number;
    rowHeight: number;
};

export type DashboardState = {
    widgets: ReadonlyArray<DashboardWidget>;
    grid: DashboardGrid;
    updatedAt: number;
};

export type AddWidgetResult =
    | {
          ok: true;
          state: DashboardState;
          widget: DashboardWidget;
      }
    | {
          ok: false;
          state: DashboardState;
          reason: "widget-not-found";
      };

export type DashboardPersistence = {
    load: (userId: string) => Promise<DashboardState | null>;
    save: (userId: string, state: DashboardState) => Promise<void>;
};

export type AddWidgetOptions = {
    placement?: Partial<WidgetPlacement>;
    now?: () => number;
    createId?: () => string;
};

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const normalizeGrid = (grid: DashboardGrid): DashboardGrid => ({
    columns: Math.max(1, grid.columns),
    rowHeight: Math.max(1, grid.rowHeight),
});

const rectsOverlap = (a: WidgetPlacement, b: WidgetPlacement): boolean => {
    const aRight = a.x + a.w;
    const aBottom = a.y + a.h;
    const bRight = b.x + b.w;
    const bBottom = b.y + b.h;

    const separated =
        aRight <= b.x ||
        bRight <= a.x ||
        aBottom <= b.y ||
        bBottom <= a.y;

    return !separated;
};

const findNextAvailablePlacement = (
    widgets: ReadonlyArray<DashboardWidget>,
    grid: DashboardGrid,
    size: { w: number; h: number },
    requested?: Partial<WidgetPlacement>,
): WidgetPlacement => {
    const normalizedGrid = normalizeGrid(grid);
    const requestedWidth = requested?.w ?? size.w;
    const requestedHeight = requested?.h ?? size.h;
    const width = clamp(requestedWidth, 1, normalizedGrid.columns);
    const height = Math.max(1, requestedHeight);
    const requestedX = requested?.x ?? 0;
    const requestedY = requested?.y ?? widgets.reduce(
        (maxY, widget) =>
            Math.max(maxY, widget.position.y + widget.position.h),
        0,
    );

    const basePlacement: WidgetPlacement = {
        x: clamp(requestedX, 0, normalizedGrid.columns - width),
        y: Math.max(0, requestedY),
        w: width,
        h: height,
    };

    const hasCollision = widgets.some((widget) =>
        rectsOverlap(basePlacement, widget.position),
    );

    if (!hasCollision) {
        return basePlacement;
    }

    const maxX = Math.max(0, normalizedGrid.columns - width);
    const bottom = widgets.length === 0
        ? 0
        : widgets.reduce(
            (maxY, widget) =>
                Math.max(maxY, widget.position.y + widget.position.h),
            0,
        );
    const searchMaxY = bottom + height + 1;

    for (let y = basePlacement.y; y <= searchMaxY; y += 1) {
        const xStart = y === basePlacement.y ? basePlacement.x : 0;
        for (let x = xStart; x <= maxX; x += 1) {
            const candidate: WidgetPlacement = {
                x,
                y,
                w: width,
                h: height,
            };
            const candidateCollides = widgets.some((widget) =>
                rectsOverlap(candidate, widget.position),
            );
            if (!candidateCollides) {
                return candidate;
            }
        }
    }

    return {
        x: 0,
        y: searchMaxY,
        w: width,
        h: height,
    };
};

const defaultCreateId = (): string => {
    if (
        typeof globalThis !== "undefined" &&
        "crypto" in globalThis &&
        typeof globalThis.crypto?.randomUUID === "function"
    ) {
        return globalThis.crypto.randomUUID();
    }

    return `widget-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
};

const defaultNow = (): number => Date.now();

export const addWidgetToDashboard = (
    state: DashboardState,
    widget: WidgetDefinition,
    options: AddWidgetOptions = {},
): AddWidgetResult => {
    const placement = findNextAvailablePlacement(
        state.widgets,
        state.grid,
        widget.defaultSize,
        options.placement,
    );

    const instanceId = (options.createId ?? defaultCreateId)();
    const now = (options.now ?? defaultNow)();

    const dashboardWidget: DashboardWidget = {
        instanceId,
        widgetId: widget.id,
        title: widget.title,
        position: placement,
        addedAt: now,
    };

    const nextState: DashboardState = {
        ...state,
        widgets: [...state.widgets, dashboardWidget],
        updatedAt: now,
    };

    return {
        ok: true,
        state: nextState,
        widget: dashboardWidget,
    };
};

export const addWidgetFromLibrary = (
    state: DashboardState,
    library: ReadonlyArray<WidgetDefinition>,
    widgetId: string,
    options: AddWidgetOptions = {},
): AddWidgetResult => {
    const widget = library.find((item) => item.id === widgetId);

    if (!widget) {
        return {
            ok: false,
            state,
            reason: "widget-not-found",
        };
    }

    return addWidgetToDashboard(state, widget, options);
};

export const createLocalStorageDashboardPersistence = (
    storage: Storage | null =
        typeof globalThis !== "undefined" && "localStorage" in globalThis
            ? globalThis.localStorage
            : null,
    prefix = "dashboard",
): DashboardPersistence => {
    const keyFor = (userId: string): string => `${prefix}:${userId}`;

    const safeParse = (raw: string | null): DashboardState | null => {
        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw) as DashboardState;
        } catch {
            return null;
        }
    };

    return {
        load: async (userId: string): Promise<DashboardState | null> => {
            if (!storage) {
                return null;
            }

            return safeParse(storage.getItem(keyFor(userId)));
        },
        save: async (userId: string, state: DashboardState): Promise<void> => {
            if (!storage) {
                return;
            }

            storage.setItem(keyFor(userId), JSON.stringify(state));
        },
    };
};

export const persistDashboardState = async (
    persistence: DashboardPersistence,
    userId: string,
    state: DashboardState,
): Promise<void> => {
    await persistence.save(userId, state);
};

export const loadDashboardState = async (
    persistence: DashboardPersistence,
    userId: string,
): Promise<DashboardState | null> => persistence.load(userId);
