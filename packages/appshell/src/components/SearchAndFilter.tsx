// FILE_CONTEXT: "context-b5a44681-b024-413f-abf0-557fde2446db"

import { useAtom } from "jotai";
import { useId, useState } from "react";
import type { TaskFilters, TaskSort } from "@isomorphiq/tasks/types";
import { searchQueryAtom, taskFiltersAtom, taskSortAtom } from "../atoms.ts";

export function SearchAndFilter() {
    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
    const [filters, setFilters] = useAtom(taskFiltersAtom);
    const [sort, setSort] = useAtom(taskSortAtom);
    const [showFilters, setShowFilters] = useState(false);
    const filtersPanelId = useId();

    const visuallyHiddenStyle = {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    };

    const handleFilterChange = (filterType: keyof TaskFilters, value: unknown) => {
        setFilters((prev) => ({
            ...prev,
            [filterType]: value,
        }));
    };

    const handleSortChange = (field: TaskSort["field"]) => {
        setSort((prev) => ({
            field,
            direction: prev.field === field && prev.direction === "asc" ? "desc" : "asc",
        }));
    };

    const clearFilters = () => {
        setFilters({});
        setSearchQuery("");
        setSort({ field: "createdAt", direction: "desc" });
    };

    const hasActiveFilters = searchQuery || Object.keys(filters).length > 0;

    return (
        <div style={{ marginBottom: "16px" }}>
            {/* Search Bar */}
            <div role="search" aria-label="Task search" style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <label htmlFor="dashboard-search-input" style={visuallyHiddenStyle}>
                    Search tasks
                </label>
                <input
                    id="dashboard-search-input"
                    type="text"
                    placeholder="Search tasks by title or description..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                    }}
                />
                <button
                    type="button"
                    onClick={() => setShowFilters(!showFilters)}
                    aria-expanded={showFilters}
                    aria-controls={filtersPanelId}
                    style={{
                        padding: "8px 16px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: showFilters ? "var(--color-accent-primary)" : "var(--color-surface-secondary)",
                        color: showFilters ? "var(--color-text-on-accent)" : "var(--color-text-primary)",
                        fontSize: "14px",
                        cursor: "pointer",
                    }}
                >
                    {showFilters ? "Hide" : "Show"} Filters
                </button>
                {hasActiveFilters && (
                    <button
                        type="button"
                        onClick={clearFilters}
                        aria-label="Clear filters"
                        style={{
                            padding: "8px 16px",
                            borderRadius: "6px",
                            border: "1px solid var(--color-accent-error)",
                            background: "var(--color-accent-error)",
                            color: "var(--color-text-on-accent)",
                            fontSize: "14px",
                            cursor: "pointer",
                        }}
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div
                    id={filtersPanelId}
                    style={{
                        padding: "16px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-secondary)",
                        marginBottom: "12px",
                    }}
                >
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                            gap: "16px",
                        }}
                    >
                        {/* Status Filter */}
                        <div>
                            <label
                                htmlFor="status-filter"
                                style={{
                                    display: "block",
                                    marginBottom: "4px",
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                }}
                            >
                                Status
                            </label>
                            <select
                                id="status-filter"
                                multiple
                                value={filters.status || []}
                                onChange={(e) => {
                                    const values = Array.from(e.target.selectedOptions, (option) => option.value);
                                    handleFilterChange("status", values.length > 0 ? values : undefined);
                                }}
                                style={{
                                    width: "100%",
                                    padding: "6px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--color-border-secondary)",
                                    background: "var(--color-surface-primary)",
                                    color: "var(--color-text-primary)",
                                    fontSize: "14px",
                                }}
                            >
                                <option value="todo">Todo</option>
                                <option value="in-progress">In Progress</option>
                                <option value="done">Done</option>
                            </select>
                        </div>

                        {/* Priority Filter */}
                        <div>
                            <label
                                htmlFor="priority-filter"
                                style={{
                                    display: "block",
                                    marginBottom: "4px",
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                }}
                            >
                                Priority
                            </label>
                            <select
                                id="priority-filter"
                                multiple
                                value={filters.priority || []}
                                onChange={(e) => {
                                    const values = Array.from(e.target.selectedOptions, (option) => option.value);
                                    handleFilterChange("priority", values.length > 0 ? values : undefined);
                                }}
                                style={{
                                    width: "100%",
                                    padding: "6px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--color-border-secondary)",
                                    background: "var(--color-surface-primary)",
                                    color: "var(--color-text-primary)",
                                    fontSize: "14px",
                                }}
                            >
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>

                        {/* Date Range Filter */}
                        <div>
                            <label
                                htmlFor="from-date-filter"
                                style={{
                                    display: "block",
                                    marginBottom: "4px",
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                }}
                            >
                                From Date
                            </label>
                            <input
                                id="from-date-filter"
                                type="date"
                                value={filters.dateFrom || ""}
                                onChange={(e) => handleFilterChange("dateFrom", e.target.value || undefined)}
                                style={{
                                    width: "100%",
                                    padding: "6px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--color-border-secondary)",
                                    background: "var(--color-surface-primary)",
                                    color: "var(--color-text-primary)",
                                    fontSize: "14px",
                                }}
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="to-date-filter"
                                style={{
                                    display: "block",
                                    marginBottom: "4px",
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                }}
                            >
                                To Date
                            </label>
                            <input
                                id="to-date-filter"
                                type="date"
                                value={filters.dateTo || ""}
                                onChange={(e) => handleFilterChange("dateTo", e.target.value || undefined)}
                                style={{
                                    width: "100%",
                                    padding: "6px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--color-border-secondary)",
                                    background: "var(--color-surface-primary)",
                                    color: "var(--color-text-primary)",
                                    fontSize: "14px",
                                }}
                            />
                        </div>
                    </div>

                    {/* Sort Options */}
                    <div
                        style={{
                            marginTop: "16px",
                            paddingTop: "16px",
                            borderTop: "1px solid var(--color-border-secondary)",
                        }}
                    >
                        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                            <legend
                                style={{
                                    display: "block",
                                    marginBottom: "8px",
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                }}
                            >
                                Sort By
                            </legend>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                {[
                                    { field: "createdAt" as const, label: "Created" },
                                    { field: "updatedAt" as const, label: "Updated" },
                                    { field: "title" as const, label: "Title" },
                                    { field: "priority" as const, label: "Priority" },
                                    { field: "status" as const, label: "Status" },
                                ].map(({ field, label }) => (
                                    <button
                                        type="button"
                                        key={field}
                                        onClick={() => handleSortChange(field)}
                                        aria-pressed={sort.field === field}
                                        aria-label={`${label} sort ${sort.field === field ? sort.direction : "none"}`}
                                        style={{
                                            padding: "6px 12px",
                                            borderRadius: "4px",
                                            border: "1px solid var(--color-border-secondary)",
                                            background:
                                                sort.field === field
                                                    ? "var(--color-accent-primary)"
                                                    : "var(--color-surface-secondary)",
                                            color:
                                                sort.field === field
                                                    ? "var(--color-text-on-accent)"
                                                    : "var(--color-text-primary)",
                                            fontSize: "12px",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {label} {sort.field === field && (sort.direction === "asc" ? "↑" : "↓")}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                    </div>
                </div>
            )}
        </div>
    );
}
