// FILE_CONTEXT: "context-dd3bc9a7-e1de-4a88-8223-28db10e5ca41"

# Widget Library Discovery API and UI

## Overview

The widget library in the web dashboard is discovered from the DOM, not fetched from a dedicated JSON endpoint. The server embeds an initial widget state payload in the HTML response, and the client builds a catalog from elements tagged with data attributes.

Primary sources:
- UI and discovery logic: `packages/dashboard/src/web/dashboard.ts`
- Widget library data model for service usage: `packages/supervisor/src/dashboard-model.ts`
- Add and remove service behavior: `packages/supervisor/src/dashboard-service.ts`

## Discovery Data Contract (Widget Catalog)

The widget catalog is derived from elements that match `[data-widget-id]`. Each widget element is paired with the closest ancestor that defines `data-widget-container`.

Required element attributes:
- `data-widget-id`: Stable widget identifier.
- `data-widget-container`: Container category for grouping and sorting (set on ancestor).

Optional element attributes:
- `data-widget-label`: Explicit label for the library list and tooltip.
- `data-widget-home-container`: Home container id for restoring placement.

Label discovery order:
1. `data-widget-label`
2. `.metric-label` or `.health-title` text
3. Title case derived from `data-widget-id`

Discovered catalog item shape:
```json
{
    "id": "overview-total",
    "label": "Total Tasks",
    "containerId": "overview-metrics",
    "containerLabel": "Overview",
    "description": "Total tasks across your workspace."
}
```

Container labels and ordering are driven by:
- `WIDGET_CONTAINER_LABELS` for display names
- `WIDGET_CONTAINER_ORDER` for sorting

## Widget Library Discovery API Responses

### Initial widget state (HTML embedded)

The server returns an embedded JSON script with the initial widget state:
```json
{
    "widgetLayout": {
        "overview-metrics": ["overview-total", "overview-pending"],
        "queue-metrics": ["queue-total"],
        "health-grid": ["health-system"]
    },
    "hiddenWidgetIds": ["overview-connections"],
    "widgetSizes": {
        "overview-total": "large",
        "health-system": "medium"
    }
}
```

### Persist layout updates

Endpoint: `POST /api/widgets/layout`

Request payloads are flexible. Supported shapes:
```json
{
    "widgetLayout": {
        "overview-metrics": ["overview-total", "overview-pending"],
        "queue-metrics": ["queue-total"]
    }
}
```
```json
{
    "containerId": "overview-metrics",
    "widgetIds": ["overview-total", "overview-pending"]
}
```

Response example:
```json
{
    "widgetLayout": {
        "overview-metrics": ["overview-total", "overview-pending"],
        "queue-metrics": ["queue-total"]
    }
}
```

### Persist visibility updates

Endpoint: `POST /api/widgets/visibility`

Request payloads are flexible. Supported shapes:
```json
{
    "hiddenWidgetIds": ["overview-connections"]
}
```
```json
{
    "widgetId": "overview-connections",
    "hidden": true
}
```

Response example:
```json
{
    "hiddenWidgetIds": ["overview-connections"]
}
```

## UI Component Usage Guide

The widget library UI renders in the "Widgets" tab and is composed of:
- `#widgetLibrarySearch`: Search input
- `#widgetLibraryFilterGroup`: Category filters
- `#widgetLibrarySelectionSummary`: Selection status
- `#widgetLibraryResults`: Search results summary text
- `#widgetLibraryList`: Render target for widget sections
- `#widgetLimitMessage`: Limit warnings

Behavior summary:
- Widget selection only applies to hidden widgets. Selecting a visible widget no-ops.
- "Add Selected" is disabled while layout sync is pending or the widget limit is reached.
- "Show All" and "Hide All" trigger visibility updates and persist changes.
- Tooltip content is derived from `WIDGET_LIBRARY_DESCRIPTION_OVERRIDES` and `WIDGET_LIBRARY_PREVIEW_OVERRIDES`, with fallback labels.

Limit handling:
- The maximum number of visible widgets defaults to 20.
- Override with `data-widget-limit` on the `<body>` element.

## Integration Steps for Adding a New Widget

1. Add widget markup in `packages/dashboard/src/web/dashboard.ts` under a container that has `data-widget-container`:
```html
<div class="metric-card" data-widget-id="overview-custom" data-widget-label="Custom Metric">
    <div class="metric-value" id="customMetricValue">-</div>
    <div class="metric-label">Custom Metric</div>
</div>
```

2. If the widget belongs to a new container, add the container to `WIDGET_CONTAINER_LABELS` and `WIDGET_CONTAINER_ORDER` to control library grouping and sorting.

3. If the default description or preview text is not sufficient, add entries to:
    - `WIDGET_LIBRARY_DESCRIPTION_OVERRIDES`
    - `WIDGET_LIBRARY_PREVIEW_OVERRIDES`

4. If the widget needs a stable home container after drag or layout updates, ensure the widget element can resolve a `data-widget-home-container` either directly or via a parent container.

5. Align IDs with service side models when needed:
    - `WidgetLibrary` in `packages/supervisor/src/dashboard-model.ts`
    - `addWidgetFromLibrary` in `packages/supervisor/src/dashboard-service.ts`

6. Update tests in `packages/dashboard/src/web/dashboard.spec.ts` when adding new widget ids or new widget containers that affect library rendering.

## Model Notes

There are multiple widget model definitions in the supervisor package. For new work:
- Prefer the `WidgetLibrary` schema in `packages/supervisor/src/dashboard-model.ts` for typed widget definitions.
- Use `packages/supervisor/src/dashboard-service.ts` for add and remove logic.
- Treat `packages/supervisor/dashboard_add_widget.ts` as legacy unless a workflow explicitly depends on it.
