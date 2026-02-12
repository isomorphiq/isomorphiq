import type { Task } from "@isomorphiq/tasks/types";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { refreshAtom, tasksAtom } from "../atoms.ts";
import { authAtom } from "../authAtoms.ts";
import { Header, Layout } from "../components/Layout.tsx";
import { PriorityBadge } from "../components/PriorityBadge.tsx";
import { SectionCard } from "../components/SectionCard.tsx";
import { TypeBadge } from "../components/TypeBadge.tsx";

const PRIORITY_ORDER: Record<Task["priority"], number> = {
    high: 0,
    medium: 1,
    low: 2,
};

const STATUS_ORDER: Record<Task["status"], number> = {
    todo: 0,
    "in-progress": 1,
    done: 2,
    invalid: 3,
};

const STATUS_OPTIONS: Task["status"][] = ["todo", "in-progress", "done", "invalid"];
const PRIORITY_OPTIONS: Task["priority"][] = ["high", "medium", "low"];

const sortPortfolioTasks = (left: Task, right: Task): number => {
    const priorityDiff = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDiff !== 0) {
        return priorityDiff;
    }
    const statusDiff = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    if (statusDiff !== 0) {
        return statusDiff;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
};

const getThemeIdFromInitiative = (initiative: Task, themeIds: Set<string>): string | null => {
    const dependencies = initiative.dependencies ?? [];
    const match = dependencies.find((dependencyId) => themeIds.has(dependencyId));
    return match ?? null;
};

export function PortfolioPage() {
    const tasks = useAtomValue(tasksAtom) ?? [];
    const [auth] = useAtom(authAtom);
    const bumpRefresh = useSetAtom(refreshAtom);
    const [themeTitle, setThemeTitle] = useState("");
    const [themeDescription, setThemeDescription] = useState("");
    const [themePriority, setThemePriority] = useState<Task["priority"]>("medium");
    const [initiativeTitle, setInitiativeTitle] = useState("");
    const [initiativeDescription, setInitiativeDescription] = useState("");
    const [initiativePriority, setInitiativePriority] = useState<Task["priority"]>("medium");
    const [initiativeThemeId, setInitiativeThemeId] = useState("");
    const [isCreatingTheme, setIsCreatingTheme] = useState(false);
    const [isCreatingInitiative, setIsCreatingInitiative] = useState(false);
    const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);

    const themes = useMemo(
        () =>
            tasks
                .filter((task) => task.type === "theme")
                .slice()
                .sort(sortPortfolioTasks),
        [tasks],
    );

    const themeIdSet = useMemo(
        () =>
            new Set(
                themes
                    .map((theme) => theme.id)
                    .filter((themeId): themeId is string => typeof themeId === "string" && themeId.length > 0),
            ),
        [themes],
    );

    const initiatives = useMemo(
        () =>
            tasks
                .filter((task) => task.type === "initiative")
                .slice()
                .sort(sortPortfolioTasks),
        [tasks],
    );

    const themeById = useMemo(
        () =>
            themes.reduce<Record<string, Task>>((acc, theme) => {
                if (!theme.id) {
                    return acc;
                }
                return { ...acc, [theme.id]: theme };
            }, {}),
        [themes],
    );

    const initiativesByTheme = useMemo(
        () =>
            initiatives.reduce<Record<string, Task[]>>((acc, initiative) => {
                const themeId = getThemeIdFromInitiative(initiative, themeIdSet);
                if (!themeId) {
                    return acc;
                }
                const existing = acc[themeId] ?? [];
                return { ...acc, [themeId]: [...existing, initiative] };
            }, {}),
        [initiatives, themeIdSet],
    );

    const unlinkedInitiatives = useMemo(
        () =>
            initiatives.filter((initiative) => !getThemeIdFromInitiative(initiative, themeIdSet)),
        [initiatives, themeIdSet],
    );

    const refresh = () => bumpRefresh((count) => count + 1);

    const ensureAuthToken = (): string => {
        const token = auth.token ?? localStorage.getItem("authToken");
        if (!token) {
            throw new Error("Authentication required to manage portfolio items.");
        }
        return token;
    };

    const createPortfolioItem = async (input: {
        title: string;
        description: string;
        priority: Task["priority"];
        type: "theme" | "initiative";
        dependencies?: string[];
    }): Promise<void> => {
        const token = ensureAuthToken();
        const response = await fetch("/api/tasks", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                title: input.title,
                description: input.description,
                priority: input.priority,
                type: input.type,
                createdBy: auth.user?.username ?? "portfolio-manager",
                ...(input.dependencies && input.dependencies.length > 0
                    ? { dependencies: input.dependencies }
                    : {}),
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error ?? `Failed to create ${input.type}`);
        }
    };

    const updateTaskStatus = async (taskId: string, status: Task["status"]): Promise<void> => {
        const token = ensureAuthToken();
        const response = await fetch(`/api/tasks/${taskId}/status`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ status }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error ?? "Failed to update status");
        }
    };

    const updateTaskPriority = async (taskId: string, priority: Task["priority"]): Promise<void> => {
        const token = ensureAuthToken();
        const response = await fetch(`/api/tasks/${taskId}/priority`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ priority }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error ?? "Failed to update priority");
        }
    };

    const handleCreateTheme = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!themeTitle.trim() || !themeDescription.trim()) {
            setErrorMessage("Theme title and description are required.");
            return;
        }
        setIsCreatingTheme(true);
        setErrorMessage(null);
        setInfoMessage(null);
        try {
            await createPortfolioItem({
                title: themeTitle.trim(),
                description: themeDescription.trim(),
                priority: themePriority,
                type: "theme",
            });
            setThemeTitle("");
            setThemeDescription("");
            setThemePriority("medium");
            setInfoMessage("Theme created.");
            refresh();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to create theme.");
        } finally {
            setIsCreatingTheme(false);
        }
    };

    const handleCreateInitiative = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!initiativeTitle.trim() || !initiativeDescription.trim()) {
            setErrorMessage("Initiative title and description are required.");
            return;
        }
        setIsCreatingInitiative(true);
        setErrorMessage(null);
        setInfoMessage(null);
        try {
            await createPortfolioItem({
                title: initiativeTitle.trim(),
                description: initiativeDescription.trim(),
                priority: initiativePriority,
                type: "initiative",
                dependencies: initiativeThemeId ? [initiativeThemeId] : [],
            });
            setInitiativeTitle("");
            setInitiativeDescription("");
            setInitiativePriority("medium");
            setInitiativeThemeId("");
            setInfoMessage("Initiative created.");
            refresh();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to create initiative.");
        } finally {
            setIsCreatingInitiative(false);
        }
    };

    const handleTaskStatusChange = async (task: Task, status: Task["status"]) => {
        if (!task.id || task.status === status) {
            return;
        }
        setUpdatingTaskId(task.id);
        setErrorMessage(null);
        setInfoMessage(null);
        try {
            await updateTaskStatus(task.id, status);
            setInfoMessage(`Updated ${task.type} status.`);
            refresh();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to update task status.");
        } finally {
            setUpdatingTaskId(null);
        }
    };

    const handleTaskPriorityChange = async (task: Task, priority: Task["priority"]) => {
        if (!task.id || task.priority === priority) {
            return;
        }
        setUpdatingTaskId(task.id);
        setErrorMessage(null);
        setInfoMessage(null);
        try {
            await updateTaskPriority(task.id, priority);
            setInfoMessage(`Updated ${task.type} priority.`);
            refresh();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to update task priority.");
        } finally {
            setUpdatingTaskId(null);
        }
    };

    return (
        <Layout>
            <Header
                title="Portfolio"
                subtitle="Manage strategic themes and initiatives in one place"
                showAuthControls={false}
            />
            <div style={{ display: "grid", gap: "16px" }}>
                {!auth.isAuthenticated ? (
                    <SectionCard title="Read-only mode">
                        <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
                            Sign in to create and update themes or initiatives.
                        </p>
                    </SectionCard>
                ) : null}

                {errorMessage ? (
                    <div
                        style={{
                            border: "1px solid #ef4444",
                            background: "rgba(239, 68, 68, 0.12)",
                            borderRadius: "10px",
                            padding: "12px",
                            color: "#fecaca",
                            fontWeight: 600,
                        }}
                    >
                        {errorMessage}
                    </div>
                ) : null}

                {infoMessage ? (
                    <div
                        style={{
                            border: "1px solid #22c55e",
                            background: "rgba(34, 197, 94, 0.12)",
                            borderRadius: "10px",
                            padding: "12px",
                            color: "#bbf7d0",
                            fontWeight: 600,
                        }}
                    >
                        {infoMessage}
                    </div>
                ) : null}

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "12px",
                    }}
                >
                    <SectionCard title="Themes" countLabel={`${themes.length} total`}>
                        <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                            Active: {themes.filter((theme) => theme.status !== "done").length}
                        </div>
                    </SectionCard>
                    <SectionCard title="Initiatives" countLabel={`${initiatives.length} total`}>
                        <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                            Linked to themes: {initiatives.length - unlinkedInitiatives.length}
                        </div>
                    </SectionCard>
                    <SectionCard title="Alignment" countLabel="Dependency health">
                        <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                            Unlinked initiatives: {unlinkedInitiatives.length}
                        </div>
                    </SectionCard>
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                        gap: "16px",
                    }}
                >
                    <SectionCard title="Create Theme">
                        <form onSubmit={handleCreateTheme} style={{ display: "grid", gap: "10px" }}>
                            <input
                                type="text"
                                placeholder="Theme title"
                                value={themeTitle}
                                disabled={isCreatingTheme || !auth.isAuthenticated}
                                onChange={(event) => setThemeTitle(event.target.value)}
                                style={inputStyle}
                            />
                            <textarea
                                placeholder="Describe the strategic outcome and scope"
                                value={themeDescription}
                                disabled={isCreatingTheme || !auth.isAuthenticated}
                                onChange={(event) => setThemeDescription(event.target.value)}
                                rows={3}
                                style={textAreaStyle}
                            />
                            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                <label style={labelStyle} htmlFor="theme-priority">
                                    Priority
                                </label>
                                <select
                                    id="theme-priority"
                                    value={themePriority}
                                    disabled={isCreatingTheme || !auth.isAuthenticated}
                                    onChange={(event) =>
                                        setThemePriority(event.target.value as Task["priority"])
                                    }
                                    style={selectStyle}
                                >
                                    {PRIORITY_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="submit"
                                    disabled={isCreatingTheme || !auth.isAuthenticated}
                                    style={primaryButtonStyle}
                                >
                                    {isCreatingTheme ? "Creating..." : "Create theme"}
                                </button>
                            </div>
                        </form>
                    </SectionCard>

                    <SectionCard title="Create Initiative">
                        <form onSubmit={handleCreateInitiative} style={{ display: "grid", gap: "10px" }}>
                            <input
                                type="text"
                                placeholder="Initiative title"
                                value={initiativeTitle}
                                disabled={isCreatingInitiative || !auth.isAuthenticated}
                                onChange={(event) => setInitiativeTitle(event.target.value)}
                                style={inputStyle}
                            />
                            <textarea
                                placeholder="Describe the initiative outcomes and acceptance goals"
                                value={initiativeDescription}
                                disabled={isCreatingInitiative || !auth.isAuthenticated}
                                onChange={(event) => setInitiativeDescription(event.target.value)}
                                rows={3}
                                style={textAreaStyle}
                            />
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "120px 1fr",
                                    alignItems: "center",
                                    gap: "10px",
                                }}
                            >
                                <label style={labelStyle} htmlFor="initiative-theme">
                                    Parent theme
                                </label>
                                <select
                                    id="initiative-theme"
                                    value={initiativeThemeId}
                                    disabled={isCreatingInitiative || !auth.isAuthenticated}
                                    onChange={(event) => setInitiativeThemeId(event.target.value)}
                                    style={selectStyle}
                                >
                                    <option value="">No parent theme</option>
                                    {themes.map((theme) => (
                                        <option key={theme.id} value={theme.id}>
                                            {theme.title}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                <label style={labelStyle} htmlFor="initiative-priority">
                                    Priority
                                </label>
                                <select
                                    id="initiative-priority"
                                    value={initiativePriority}
                                    disabled={isCreatingInitiative || !auth.isAuthenticated}
                                    onChange={(event) =>
                                        setInitiativePriority(event.target.value as Task["priority"])
                                    }
                                    style={selectStyle}
                                >
                                    {PRIORITY_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="submit"
                                    disabled={isCreatingInitiative || !auth.isAuthenticated}
                                    style={primaryButtonStyle}
                                >
                                    {isCreatingInitiative ? "Creating..." : "Create initiative"}
                                </button>
                            </div>
                        </form>
                    </SectionCard>
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                        gap: "16px",
                    }}
                >
                    <SectionCard title="Themes" countLabel={`${themes.length} items`}>
                        {themes.length === 0 ? (
                            <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
                                No themes yet.
                            </p>
                        ) : (
                            <div style={{ display: "grid", gap: "10px" }}>
                                {themes.map((theme) => {
                                    const childInitiatives = theme.id ? initiativesByTheme[theme.id] ?? [] : [];
                                    const isUpdating = updatingTaskId === theme.id;
                                    return (
                                        <div key={theme.id} style={itemCardStyle}>
                                            <div style={itemHeadStyle}>
                                                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                                    <TypeBadge type={theme.type} />
                                                    <PriorityBadge priority={theme.priority} />
                                                </div>
                                                <Link to={`/tasks/${theme.id}`} style={linkStyle}>
                                                    Open
                                                </Link>
                                            </div>
                                            <div style={{ fontWeight: 700 }}>{theme.title}</div>
                                            <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                                                {theme.description}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                                Initiatives linked: {childInitiatives.length}
                                            </div>
                                            <div style={controlsRowStyle}>
                                                <select
                                                    value={theme.status}
                                                    disabled={isUpdating || !auth.isAuthenticated || !theme.id}
                                                    onChange={(event) =>
                                                        void handleTaskStatusChange(
                                                            theme,
                                                            event.target.value as Task["status"],
                                                        )
                                                    }
                                                    style={compactSelectStyle}
                                                >
                                                    {STATUS_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option}
                                                        </option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={theme.priority}
                                                    disabled={isUpdating || !auth.isAuthenticated || !theme.id}
                                                    onChange={(event) =>
                                                        void handleTaskPriorityChange(
                                                            theme,
                                                            event.target.value as Task["priority"],
                                                        )
                                                    }
                                                    style={compactSelectStyle}
                                                >
                                                    {PRIORITY_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </SectionCard>

                    <SectionCard title="Initiatives" countLabel={`${initiatives.length} items`}>
                        {initiatives.length === 0 ? (
                            <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
                                No initiatives yet.
                            </p>
                        ) : (
                            <div style={{ display: "grid", gap: "10px" }}>
                                {initiatives.map((initiative) => {
                                    const parentThemeId = getThemeIdFromInitiative(initiative, themeIdSet);
                                    const parentTheme = parentThemeId ? themeById[parentThemeId] : null;
                                    const isUpdating = updatingTaskId === initiative.id;
                                    return (
                                        <div key={initiative.id} style={itemCardStyle}>
                                            <div style={itemHeadStyle}>
                                                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                                    <TypeBadge type={initiative.type} />
                                                    <PriorityBadge priority={initiative.priority} />
                                                </div>
                                                <Link to={`/tasks/${initiative.id}`} style={linkStyle}>
                                                    Open
                                                </Link>
                                            </div>
                                            <div style={{ fontWeight: 700 }}>{initiative.title}</div>
                                            <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                                                {initiative.description}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                                Theme: {parentTheme ? parentTheme.title : "Unlinked"}
                                            </div>
                                            <div style={controlsRowStyle}>
                                                <select
                                                    value={initiative.status}
                                                    disabled={isUpdating || !auth.isAuthenticated || !initiative.id}
                                                    onChange={(event) =>
                                                        void handleTaskStatusChange(
                                                            initiative,
                                                            event.target.value as Task["status"],
                                                        )
                                                    }
                                                    style={compactSelectStyle}
                                                >
                                                    {STATUS_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option}
                                                        </option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={initiative.priority}
                                                    disabled={isUpdating || !auth.isAuthenticated || !initiative.id}
                                                    onChange={(event) =>
                                                        void handleTaskPriorityChange(
                                                            initiative,
                                                            event.target.value as Task["priority"],
                                                        )
                                                    }
                                                    style={compactSelectStyle}
                                                >
                                                    {PRIORITY_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </SectionCard>
                </div>
            </div>
        </Layout>
    );
}

const inputStyle: CSSProperties = {
    width: "100%",
    background: "var(--color-bg-secondary)",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "10px",
    color: "var(--color-text-primary)",
    padding: "10px 12px",
    fontSize: "14px",
};

const textAreaStyle: CSSProperties = {
    ...inputStyle,
    resize: "vertical",
};

const labelStyle: CSSProperties = {
    color: "var(--color-text-muted)",
    fontSize: "13px",
    fontWeight: 600,
};

const selectStyle: CSSProperties = {
    ...inputStyle,
    padding: "8px 10px",
};

const compactSelectStyle: CSSProperties = {
    ...inputStyle,
    padding: "6px 8px",
    fontSize: "12px",
    maxWidth: "170px",
};

const primaryButtonStyle: CSSProperties = {
    background: "var(--color-accent-primary)",
    color: "var(--color-bg-primary)",
    border: "1px solid var(--color-accent-primary)",
    borderRadius: "10px",
    fontWeight: 700,
    fontSize: "13px",
    padding: "8px 12px",
    cursor: "pointer",
};

const itemCardStyle: CSSProperties = {
    border: "1px solid var(--color-border-primary)",
    background: "var(--color-bg-secondary)",
    borderRadius: "10px",
    padding: "10px",
    display: "grid",
    gap: "8px",
};

const itemHeadStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
};

const controlsRowStyle: CSSProperties = {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
};

const linkStyle: CSSProperties = {
    color: "var(--color-accent-secondary)",
    fontWeight: 700,
    fontSize: "12px",
    textDecoration: "none",
};
