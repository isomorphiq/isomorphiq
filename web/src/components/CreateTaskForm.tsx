import { useState } from "react";

interface CreateTaskFormProps {
	onSuccess: () => void;
}

export function CreateTaskForm({ onSuccess }: CreateTaskFormProps) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
	const [assignedTo, setAssignedTo] = useState("");
	const [dependencies, setDependencies] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!title.trim() || !description.trim()) {
			setError("Title and description are required");
			return;
		}

		setIsSubmitting(true);
		setError("");

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
					title: title.trim(),
					description: description.trim(),
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

			onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			{error && (
				<div
					style={{
						padding: "12px",
						borderRadius: "6px",
						background: "#ef4444",
						color: "white",
						fontSize: "14px",
					}}
				>
					{error}
				</div>
			)}

			<div>
				<label
					htmlFor="task-title"
					style={{
						display: "block",
						marginBottom: "4px",
						fontSize: "14px",
						color: "#9ca3af",
						fontWeight: "500",
					}}
				>
					Title *
				</label>
				<input
					id="task-title"
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Enter task title..."
					disabled={isSubmitting}
					style={{
						width: "100%",
						padding: "10px 12px",
						borderRadius: "6px",
						border: "1px solid #374151",
						background: "#111827",
						color: "#f9fafb",
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
						color: "#9ca3af",
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
					style={{
						width: "100%",
						padding: "10px 12px",
						borderRadius: "6px",
						border: "1px solid #374151",
						background: "#111827",
						color: "#f9fafb",
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
						color: "#9ca3af",
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
						border: "1px solid #374151",
						background: "#111827",
						color: "#f9fafb",
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
						color: "#9ca3af",
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
						border: "1px solid #374151",
						background: "#111827",
						color: "#f9fafb",
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
						color: "#9ca3af",
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
						border: "1px solid #374151",
						background: "#111827",
						color: "#f9fafb",
						fontSize: "14px",
					}}
				/>
			</div>

			<div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
				<button
					type="button"
					onClick={onSuccess}
					disabled={isSubmitting}
					style={{
						padding: "10px 20px",
						borderRadius: "6px",
						border: "1px solid #374151",
						background: "#374151",
						color: "#f9fafb",
						fontSize: "14px",
						cursor: isSubmitting ? "not-allowed" : "pointer",
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
						background: "#3b82f6",
						color: "white",
						fontSize: "14px",
						fontWeight: "500",
						cursor: isSubmitting ? "not-allowed" : "pointer",
					}}
				>
					{isSubmitting ? "Creating..." : "Create Task"}
				</button>
			</div>
		</form>
	);
}
