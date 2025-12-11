import { useEffect, useState } from "react";
import { useOfflineSync } from "../hooks/useOfflineSync.ts";

interface MobileCreateTaskFormProps {
	onSuccess?: () => void;
	onCancel?: () => void;
}

export function MobileCreateTaskForm({ onSuccess, onCancel }: MobileCreateTaskFormProps) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
	const [type, setType] = useState("task");
	const [assignedTo, setAssignedTo] = useState("");
	const [collaborators, setCollaborators] = useState("");
	const [dependencies, setDependencies] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});

	const { createOfflineTask, isOnline } = useOfflineSync();
	const isMobile = window.innerWidth <= 768;

	useEffect(() => {
		// Auto-focus title field on mount
		const titleInput = document.getElementById("task-title");
		if (titleInput) {
			titleInput.focus();
		}
	}, []);

	const validateForm = (): boolean => {
		const newErrors: Record<string, string> = {};

		if (!title.trim()) {
			newErrors.title = "Title is required";
		} else if (title.length > 200) {
			newErrors.title = "Title must be less than 200 characters";
		}

		if (description.length > 2000) {
			newErrors.description = "Description must be less than 2000 characters";
		}

		if (assignedTo && !isValidEmail(assignedTo) && !isValidUsername(assignedTo)) {
			newErrors.assignedTo = "Must be a valid email or username";
		}

		if (collaborators) {
			const collaboratorList = collaborators.split(",").map((c) => c.trim());
			for (const collaborator of collaboratorList) {
				if (collaborator && !isValidEmail(collaborator) && !isValidUsername(collaborator)) {
					newErrors.collaborators = "Each collaborator must be a valid email or username";
					break;
				}
			}
		}

		if (dependencies) {
			const depList = dependencies.split(",").map((d) => d.trim());
			for (const dep of depList) {
				if (dep && !isValidTaskId(dep)) {
					newErrors.dependencies = "Each dependency must be a valid task ID";
					break;
				}
			}
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const isValidEmail = (email: string): boolean => {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	};

	const isValidUsername = (username: string): boolean => {
		return /^[a-zA-Z0-9_-]{3,20}$/.test(username);
	};

	const isValidTaskId = (taskId: string): boolean => {
		return /^[a-zA-Z0-9_-]{8,}$/.test(taskId);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateForm()) {
			return;
		}

		setIsSubmitting(true);

		try {
			const collaboratorList = collaborators
				? collaborators
						.split(",")
						.map((c) => c.trim())
						.filter(Boolean)
				: [];

			const dependencyList = dependencies
				? dependencies
						.split(",")
						.map((d) => d.trim())
						.filter(Boolean)
				: [];

			await createOfflineTask({
				title: title.trim(),
				description: description.trim(),
				priority,
				type,
				assignedTo: assignedTo.trim() || undefined,
				collaborators: collaboratorList.length > 0 ? collaboratorList : undefined,
				dependencies: dependencyList.length > 0 ? dependencyList : undefined,
				status: "todo",
			});

			// Reset form
			setTitle("");
			setDescription("");
			setPriority("medium");
			setType("task");
			setAssignedTo("");
			setCollaborators("");
			setDependencies("");
			setErrors({});

			if (onSuccess) {
				onSuccess();
			}
		} catch (error) {
			console.error("Failed to create task:", error);
			setErrors({ submit: "Failed to create task. Please try again." });
		} finally {
			setIsSubmitting(false);
		}
	};

	const inputStyle = {
		width: "100%",
		padding: isMobile ? "10px 12px" : "12px 16px",
		borderRadius: "8px",
		border: "1px solid #374151",
		background: "#1f2937",
		color: "#f9fafb",
		fontSize: isMobile ? "14px" : "16px",
		transition: "all 0.2s ease",
	};

	const labelStyle = {
		display: "block",
		marginBottom: "6px",
		fontWeight: 600,
		color: "#e2e8f0",
		fontSize: isMobile ? "12px" : "14px",
	};

	const errorStyle = {
		color: "#ef4444",
		fontSize: isMobile ? "11px" : "12px",
		marginTop: "4px",
	};

	return (
		<div
			style={{
				background: "#0b1220",
				borderRadius: "12px",
				border: "1px solid #1f2937",
				padding: isMobile ? "16px" : "24px",
				boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "20px",
				}}
			>
				<h2
					style={{
						margin: 0,
						fontSize: isMobile ? "18px" : "20px",
						color: "#f9fafb",
						fontWeight: 700,
					}}
				>
					Create New Task
				</h2>
				{onCancel && (
					<button
						type="button"
						onClick={onCancel}
						style={{
							background: "none",
							border: "none",
							color: "#94a3b8",
							fontSize: "20px",
							cursor: "pointer",
							padding: "4px",
							borderRadius: "4px",
						}}
					>
						✕
					</button>
				)}
			</div>

			{/* Offline Indicator */}
			{!isOnline && (
				<div
					style={{
						background: "#f59e0b20",
						border: "1px solid #f59e0b50",
						borderRadius: "8px",
						padding: "10px",
						marginBottom: "16px",
						color: "#f59e0b",
						fontSize: isMobile ? "12px" : "14px",
						fontWeight: 600,
					}}
				>
					⚠️ You're offline. This task will be saved locally and synced when you're back online.
				</div>
			)}

			<form onSubmit={handleSubmit}>
				{/* Title */}
				<div style={{ marginBottom: "16px" }}>
					<label htmlFor="task-title" style={labelStyle}>
						Title *
					</label>
					<input
						id="task-title"
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Enter task title..."
						style={{
							...inputStyle,
							borderColor: errors.title ? "#ef4444" : "#374151",
						}}
						disabled={isSubmitting}
					/>
					{errors.title && <div style={errorStyle}>{errors.title}</div>}
				</div>

				{/* Description */}
				<div style={{ marginBottom: "16px" }}>
					<label htmlFor="task-description" style={labelStyle}>
						Description
					</label>
					<textarea
						id="task-description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Enter task description..."
						rows={isMobile ? 3 : 4}
						style={{
							...inputStyle,
							resize: "vertical",
							minHeight: "80px",
							borderColor: errors.description ? "#ef4444" : "#374151",
						}}
						disabled={isSubmitting}
					/>
					{errors.description && <div style={errorStyle}>{errors.description}</div>}
				</div>

				{/* Priority and Type */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
						gap: "16px",
						marginBottom: "16px",
					}}
				>
					<div>
						<label htmlFor="task-priority" style={labelStyle}>
							Priority
						</label>
						<select
							id="task-priority"
							value={priority}
							onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
							style={inputStyle}
							disabled={isSubmitting}
						>
							<option value="low">Low</option>
							<option value="medium">Medium</option>
							<option value="high">High</option>
						</select>
					</div>

					<div>
						<label htmlFor="task-type" style={labelStyle}>
							Type
						</label>
						<select
							id="task-type"
							value={type}
							onChange={(e) => setType(e.target.value)}
							style={inputStyle}
							disabled={isSubmitting}
						>
							<option value="task">Task</option>
							<option value="bug">Bug</option>
							<option value="feature">Feature</option>
							<option value="improvement">Improvement</option>
							<option value="documentation">Documentation</option>
						</select>
					</div>
				</div>

				{/* Assigned To */}
				<div style={{ marginBottom: "16px" }}>
					<label htmlFor="task-assigned" style={labelStyle}>
						Assigned To
					</label>
					<input
						id="task-assigned"
						type="text"
						value={assignedTo}
						onChange={(e) => setAssignedTo(e.target.value)}
						placeholder="Email or username..."
						style={{
							...inputStyle,
							borderColor: errors.assignedTo ? "#ef4444" : "#374151",
						}}
						disabled={isSubmitting}
					/>
					{errors.assignedTo && <div style={errorStyle}>{errors.assignedTo}</div>}
				</div>

				{/* Collaborators */}
				<div style={{ marginBottom: "16px" }}>
					<label htmlFor="task-collaborators" style={labelStyle}>
						Collaborators
					</label>
					<input
						id="task-collaborators"
						type="text"
						value={collaborators}
						onChange={(e) => setCollaborators(e.target.value)}
						placeholder="email1@example.com, username2, email3@example.com..."
						style={{
							...inputStyle,
							borderColor: errors.collaborators ? "#ef4444" : "#374151",
						}}
						disabled={isSubmitting}
					/>
					<div style={{ color: "#64748b", fontSize: isMobile ? "11px" : "12px", marginTop: "4px" }}>
						Separate multiple collaborators with commas
					</div>
					{errors.collaborators && <div style={errorStyle}>{errors.collaborators}</div>}
				</div>

				{/* Dependencies */}
				<div style={{ marginBottom: "20px" }}>
					<label htmlFor="task-dependencies" style={labelStyle}>
						Dependencies
					</label>
					<input
						id="task-dependencies"
						type="text"
						value={dependencies}
						onChange={(e) => setDependencies(e.target.value)}
						placeholder="task-id-1, task-id-2..."
						style={{
							...inputStyle,
							borderColor: errors.dependencies ? "#ef4444" : "#374151",
						}}
						disabled={isSubmitting}
					/>
					<div style={{ color: "#64748b", fontSize: isMobile ? "11px" : "12px", marginTop: "4px" }}>
						Separate multiple task IDs with commas
					</div>
					{errors.dependencies && <div style={errorStyle}>{errors.dependencies}</div>}
				</div>

				{/* Submit Error */}
				{errors.submit && (
					<div
						style={{
							background: "#ef444420",
							border: "1px solid #ef444450",
							borderRadius: "8px",
							padding: "10px",
							marginBottom: "16px",
							color: "#ef4444",
							fontSize: isMobile ? "12px" : "14px",
						}}
					>
						{errors.submit}
					</div>
				)}

				{/* Actions */}
				<div
					style={{
						display: "flex",
						gap: "12px",
						justifyContent: "flex-end",
					}}
				>
					{onCancel && (
						<button
							type="button"
							onClick={onCancel}
							disabled={isSubmitting}
							style={{
								padding: isMobile ? "10px 16px" : "12px 20px",
								borderRadius: "8px",
								border: "1px solid #374151",
								background: "transparent",
								color: "#e2e8f0",
								fontSize: isMobile ? "14px" : "16px",
								fontWeight: 600,
								cursor: isSubmitting ? "not-allowed" : "pointer",
								opacity: isSubmitting ? 0.6 : 1,
							}}
						>
							Cancel
						</button>
					)}
					<button
						type="submit"
						disabled={isSubmitting || !title.trim()}
						style={{
							padding: isMobile ? "10px 20px" : "12px 24px",
							borderRadius: "8px",
							border: "none",
							background: isSubmitting ? "#6b7280" : "#3b82f6",
							color: "white",
							fontSize: isMobile ? "14px" : "16px",
							fontWeight: 600,
							cursor: isSubmitting || !title.trim() ? "not-allowed" : "pointer",
							opacity: isSubmitting || !title.trim() ? 0.6 : 1,
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}
					>
						{isSubmitting ? (
							<>
								<div
									style={{
										width: "16px",
										height: "16px",
										border: "2px solid #ffffff30",
										borderTop: "2px solid white",
										borderRadius: "50%",
										animation: "spin 1s linear infinite",
									}}
								/>
								Creating...
							</>
						) : (
							<>{isOnline ? "✓" : "📱"} Create Task</>
						)}
					</button>
				</div>
			</form>

			<style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
		</div>
	);
}
