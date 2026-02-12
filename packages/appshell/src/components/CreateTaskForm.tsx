// FILE_CONTEXT: "context-15442614-9a09-4283-b124-74e3ee2753c9"

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ActionErrorBanner, useFeedbackToasts } from "./ActionFeedback.tsx";

type CreateTaskFormProps = {
    onSuccess: () => void;
};

export function CreateTaskForm({ onSuccess }: CreateTaskFormProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
    const [assignedTo, setAssignedTo] = useState("");
    const [dependencies, setDependencies] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [canRetry, setCanRetry] = useState(false);
    const titleRef = useRef<HTMLInputElement | null>(null);
    const { pushToast } = useFeedbackToasts();

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    const submitTask = async () => {
        const trimmedTitle = title.trim();
        const trimmedDescription = description.trim();

        if (!trimmedTitle || !trimmedDescription) {
            setError("Title and description are required.");
            setCanRetry(false);
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setCanRetry(false);

        try {
            // Get auth token from localStorage
            const token = localStorage.getItem("authToken");
            if (!token) {
                throw new Error("Authentication required");
            }

            // For now, we'll use REST API since tRPC mutations aren't fully set up
            const taskResponse = await fetch("/api/tasks", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    title: trimmedTitle,
                    description: trimmedDescription,
                    priority,
                    ...(assignedTo.trim() && { assignedTo: assignedTo.trim() }),
                    ...(dependencies.trim() && {
                        dependencies: dependencies
                            .split(",")
                            .map((d) => d.trim())
                            .filter(Boolean),
                    }),
                }),
            });

            if (!taskResponse.ok) {
                const errorData = await taskResponse.json();
                throw new Error(errorData.error || "Failed to create task");
            }

            const result = await taskResponse.json();
            console.log("Task created:", result.task);

            // Reset form
            setTitle("");
            setDescription("");
            setPriority("medium");
            setAssignedTo("");
            setDependencies("");

            pushToast({ message: `Created "${trimmedTitle}".`, tone: "success" });
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
            setCanRetry(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        void submitTask();
    };

    return (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {error ? (
                <ActionErrorBanner
                    message={error}
                    actionLabel={canRetry ? "Retry" : undefined}
                    onAction={
                        canRetry
                            ? () => {
                                  if (!isSubmitting) {
                                      void submitTask();
                                  }
                              }
                            : undefined
                    }
                    onDismiss={() => setError(null)}
                />
            ) : null}

            <div>
                <label
                    htmlFor="task-title"
                    style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "14px",
                        color: "var(--color-text-muted)",
                        fontWeight: "500",
                    }}
                >
                    Title *
                </label>
                <input
                    ref={titleRef}
                    id="task-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter task title..."
                    disabled={isSubmitting}
                    required
                    style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                    }}
                />
            </div>

            <div>
                <label
                    htmlFor="task-description"
                    style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "14px",
                        color: "var(--color-text-muted)",
                        fontWeight: "500",
                    }}
                >
                    Description *
                </label>
                <textarea
                    id="task-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Enter task description..."
                    rows={3}
                    disabled={isSubmitting}
                    required
                    style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                        resize: "vertical",
                    }}
                />
            </div>

            <div>
                <label
                    htmlFor="task-priority"
                    style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "14px",
                        color: "var(--color-text-muted)",
                        fontWeight: "500",
                    }}
                >
                    Priority
                </label>
                <select
                    id="task-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
                    disabled={isSubmitting}
                    style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                    }}
                >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                </select>
            </div>

            <div>
                <label
                    htmlFor="task-assigned-to"
                    style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "14px",
                        color: "var(--color-text-muted)",
                        fontWeight: "500",
                    }}
                >
                    Assigned To (User ID)
                </label>
                <input
                    id="task-assigned-to"
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    placeholder="Enter user ID to assign task..."
                    disabled={isSubmitting}
                    style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                    }}
                />
            </div>

            <div>
                <label
                    htmlFor="task-dependencies"
                    style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "14px",
                        color: "var(--color-text-muted)",
                        fontWeight: "500",
                    }}
                >
                    Dependencies (Task IDs, comma-separated)
                </label>
                <input
                    id="task-dependencies"
                    type="text"
                    value={dependencies}
                    onChange={(e) => setDependencies(e.target.value)}
                    placeholder="e.g. task-123, task-456"
                    disabled={isSubmitting}
                    style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                    }}
                />
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                    type="button"
                    onClick={onSuccess}
                    disabled={isSubmitting}
                    style={{
                        padding: "10px 20px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-surface-secondary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                        cursor: isSubmitting ? "not-allowed" : "pointer",
                        minWidth: "140px",
                    }}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                        padding: "10px 20px",
                        borderRadius: "6px",
                        border: "none",
                        background: "var(--color-accent-primary)",
                        color: "var(--color-text-on-accent)",
                        fontSize: "14px",
                        fontWeight: "500",
                        cursor: isSubmitting ? "not-allowed" : "pointer",
                        minWidth: "160px",
                    }}
                >
                    {isSubmitting ? "Creating..." : "Create Task"}
                </button>
            </div>
        </form>
    );
}
