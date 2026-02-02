import { z } from "zod";

const WidgetPlacementSchema = z.object({
    column: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
});

const DashboardWidgetSchema = z.object({
    id: z.string().min(1),
    widgetId: z.string().min(1),
    placement: WidgetPlacementSchema,
    addedAt: z.string().min(1),
});

const DashboardStateSchema = z.object({
    version: z.number().int().nonnegative(),
    widgets: z.array(DashboardWidgetSchema),
});

type WidgetPlacement = z.output<typeof WidgetPlacementSchema>;
type DashboardWidget = z.output<typeof DashboardWidgetSchema>;
type DashboardState = z.output<typeof DashboardStateSchema>;

type AddWidgetInput = {
    state: DashboardState;
    widgetId: string;
    placement?: WidgetPlacement | null;
    defaultSize?: { width: number; height: number } | null;
    gridWidth?: number | null;
    idFactory?: (() => string) | null;
    nowIso?: (() => string) | null;
};

type AddWidgetResult = {
    state: DashboardState;
    widget: DashboardWidget;
};

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

const DEFAULT_GRID_WIDTH = 12;
const DEFAULT_WIDGET_SIZE = { width: 4, height: 4 };
const DEFAULT_STORAGE_KEY = "dashboard.widgets.v1";

const defaultIdFactory = (): string => {
    const randomPart = Math.floor(Math.random() * 1_000_000_000);
    return `widget_${Date.now()}_${randomPart}`;
};

const defaultNowIso = (): string => new Date().toISOString();

const getNextPlacement = (
    widgets: ReadonlyArray<DashboardWidget>,
    defaultSize: { width: number; height: number },
    _gridWidth: number
): WidgetPlacement => {
    const nextRow = widgets.reduce((maxRow, widget) => {
        const widgetBottom = widget.placement.row + widget.placement.height;
        return Math.max(maxRow, widgetBottom);
    }, 0);

    return {
        column: 0,
        row: nextRow,
        width: defaultSize.width,
        height: defaultSize.height,
    };
};

const addWidgetToDashboard = (input: AddWidgetInput): AddWidgetResult => {
    const defaultSize = input.defaultSize ?? DEFAULT_WIDGET_SIZE;
    const gridWidth = input.gridWidth ?? DEFAULT_GRID_WIDTH;
    const placement = input.placement ?? getNextPlacement(input.state.widgets, defaultSize, gridWidth);
    const idFactory = input.idFactory ?? defaultIdFactory;
    const nowIso = input.nowIso ?? defaultNowIso;

    const widget: DashboardWidget = {
        id: idFactory(),
        widgetId: input.widgetId,
        placement,
        addedAt: nowIso(),
    };

    const nextState: DashboardState = {
        version: input.state.version,
        widgets: [...input.state.widgets, widget],
    };

    return { state: nextState, widget };
};

const updateWidgetPlacement = (
    state: DashboardState,
    widgetInstanceId: string,
    placement: WidgetPlacement
): DashboardState => {
    const nextWidgets = state.widgets.map((widget) =>
        widget.id === widgetInstanceId ? { ...widget, placement } : widget
    );

    return { ...state, widgets: nextWidgets };
};

const loadDashboardState = (
    storage: StorageLike,
    fallback: DashboardState,
    storageKey: string = DEFAULT_STORAGE_KEY
): DashboardState => {
    const raw = storage.getItem(storageKey);
    if (raw === null) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(raw);
        const validated = DashboardStateSchema.safeParse(parsed);
        return validated.success ? validated.data : fallback;
    } catch {
        return fallback;
    }
};

const saveDashboardState = (
    storage: StorageLike,
    state: DashboardState,
    storageKey: string = DEFAULT_STORAGE_KEY
): DashboardState => {
    const payload = JSON.stringify(state);
    storage.setItem(storageKey, payload);
    return state;
};

const addWidgetAndPersist = (
    storage: StorageLike,
    input: AddWidgetInput,
    storageKey: string = DEFAULT_STORAGE_KEY
): AddWidgetResult => {
    const result = addWidgetToDashboard(input);
    saveDashboardState(storage, result.state, storageKey);
    return result;
};

export {
    DEFAULT_GRID_WIDTH,
    DEFAULT_STORAGE_KEY,
    DEFAULT_WIDGET_SIZE,
    DashboardStateSchema,
    DashboardWidgetSchema,
    WidgetPlacementSchema,
    addWidgetAndPersist,
    addWidgetToDashboard,
    loadDashboardState,
    saveDashboardState,
    updateWidgetPlacement,
};

export type {
    AddWidgetInput,
    AddWidgetResult,
    DashboardState,
    DashboardWidget,
    StorageLike,
    WidgetPlacement,
};
