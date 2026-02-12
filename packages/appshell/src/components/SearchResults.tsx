import type { SearchResult, Task } from "@isomorphiq/tasks/types";

interface SearchResultsProps {
	searchResult: SearchResult;
	isLoading?: boolean;
	onTaskClick?: (task: Task) => void;
}

export function SearchResults({ searchResult, isLoading, onTaskClick }: SearchResultsProps) {
	if (isLoading) {
		return (
			<div style={{ padding: "20px", textAlign: "center" }}>
				<div style={{ color: "#9ca3af", fontSize: "16px" }}>🔄 Searching tasks...</div>
			</div>
		);
	}

	if (!searchResult || searchResult.tasks.length === 0) {
		return (
			<div style={{ padding: "20px", textAlign: "center" }}>
				<div style={{ color: "#9ca3af", fontSize: "16px", marginBottom: "12px" }}>
					🔍 No tasks found
				</div>
				{searchResult?.query && (
					<div style={{ color: "#6b7280", fontSize: "14px" }}>
						{searchResult.query.q && `No results for "${searchResult.query.q}"`}
						{Object.keys(searchResult.query).length > 1 && " with the applied filters"}
					</div>
				)}
			</div>
		);
	}

	const highlightText = (text: string, matches?: number[]) => {
		if (!matches || matches.length === 0) return text;

		const highlightedParts: string[] = [];
		let lastIndex = 0;

		matches.forEach((index) => {
			if (index > text.length) return;
			
			// Add text before match
			if (index > lastIndex) {
				highlightedParts.push(text.substring(lastIndex, index));
			}
			
			// Add highlighted match (assuming 10-character match length)
			const matchLength = 10;
			const endIndex = Math.min(index + matchLength, text.length);
			highlightedParts.push(
				`<mark style="background: #fbbf24; color: #000; padding: 1px 2px; border-radius: 2px;">${text.substring(index, endIndex)}</mark>`
			);
			
			lastIndex = endIndex;
		});

		// Add remaining text
		if (lastIndex < text.length) {
			highlightedParts.push(text.substring(lastIndex));
		}

		return highlightedParts.join("");
	};

	const getPriorityColor = (priority: string) => {
		switch (priority) {
			case "high": return "#ef4444";
			case "medium": return "#f59e0b";
			case "low": return "#10b981";
			default: return "#6b7280";
		}
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case "todo": return "#6b7280";
			case "in-progress": return "#3b82f6";
			case "done": return "#10b981";
			default: return "#6b7280";
		}
	};

	const formatDate = (dateString: string | Date) => {
		const date = typeof dateString === "string" ? new Date(dateString) : dateString;
		return date.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	return (
		<div>
			{/* Results Header */}
			<div style={{ 
				display: "flex", 
				justifyContent: "space-between", 
				alignItems: "center", 
				marginBottom: "20px",
				padding: "16px",
				background: "#1f2937",
				borderRadius: "8px",
			}}>
				<div>
					<h3 style={{ margin: 0, color: "#f9fafb", fontSize: "16px" }}>
						Search Results ({searchResult.total} tasks)
					</h3>
					{searchResult.query.q && (
						<p style={{ margin: "4px 0 0 0", color: "#9ca3af", fontSize: "14px" }}>
							Showing results for "{searchResult.query.q}"
						</p>
					)}
				</div>
				
				{/* Pagination info */}
				<div style={{ color: "#9ca3af", fontSize: "14px" }}>
					{searchResult.query.offset && searchResult.query.limit && (
						<span>
							{searchResult.query.offset + 1}-{Math.min(searchResult.query.offset + searchResult.query.limit, searchResult.total)} of {searchResult.total}
						</span>
					)}
				</div>
			</div>

			{/* Facets and Filters */}
			{searchResult.facets && (
				<div style={{ 
					marginBottom: "20px", 
					padding: "16px", 
					background: "#1f2937", 
					borderRadius: "8px" 
				}}>
					<h4 style={{ margin: "0 0 12px 0", color: "#f9fafb", fontSize: "14px" }}>Filter by</h4>
					<div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
						{/* Status facets */}
						<div>
							<span style={{ color: "#9ca3af", fontSize: "12px", marginRight: "8px" }}>Status:</span>
							{Object.entries(searchResult.facets.status).map(([status, count]) => (
								<span 
									key={status} 
									style={{ 
										marginRight: "12px",
										color: getStatusColor(status),
										fontSize: "12px",
										cursor: "pointer"
									}}
								>
									{status} ({count})
								</span>
							))}
						</div>

						{/* Priority facets */}
						<div>
							<span style={{ color: "#9ca3af", fontSize: "12px", marginRight: "8px" }}>Priority:</span>
							{Object.entries(searchResult.facets.priority).map(([priority, count]) => (
								<span 
									key={priority} 
									style={{ 
										marginRight: "12px",
										color: getPriorityColor(priority),
										fontSize: "12px",
										cursor: "pointer"
									}}
								>
									{priority} ({count})
								</span>
							))}
						</div>

						{/* Type facets */}
						<div>
							<span style={{ color: "#9ca3af", fontSize: "12px", marginRight: "8px" }}>Type:</span>
							{Object.entries(searchResult.facets.type).map(([type, count]) => (
								<span 
									key={type} 
									style={{ 
										marginRight: "12px",
										color: "#9ca3af",
										fontSize: "12px",
										cursor: "pointer"
									}}
								>
									{type} ({count})
								</span>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Search Suggestions */}
			{searchResult.suggestions && searchResult.suggestions.length > 0 && (
				<div style={{ 
					marginBottom: "20px", 
					padding: "12px 16px", 
					background: "#1f2937", 
					borderRadius: "8px" 
				}}>
					<span style={{ color: "#9ca3af", fontSize: "12px", marginRight: "8px" }}>Try searching for:</span>
					{searchResult.suggestions.map((suggestion, index) => (
						<button
							key={index}
							type="button"
							onClick={() => {
								// This would need to be handled by parent component
								console.log("Search for:", suggestion);
							}}
							style={{
								margin: "4px 4px 4px 0",
								padding: "4px 8px",
								borderRadius: "4px",
								border: "1px solid #374151",
								background: "#374151",
								color: "#3b82f6",
								fontSize: "12px",
								cursor: "pointer",
							}}
						>
							{suggestion}
						</button>
					))}
				</div>
			)}

			{/* Results List */}
			<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
				{searchResult.tasks.map((task, index) => (
					<div
						key={task.id}
						onClick={() => onTaskClick?.(task)}
						style={{
							padding: "16px",
							background: "#1f2937",
							borderRadius: "8px",
							border: "1px solid #374151",
							cursor: "pointer",
							transition: "all 0.2s ease",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = "#374151";
							e.currentTarget.style.borderColor = "#4b5563";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "#1f2937";
							e.currentTarget.style.borderColor = "#374151";
						}}
					>
						{/* Task Header */}
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
							<h4 
								style={{ 
									margin: 0, 
									color: "#f9fafb", 
									fontSize: "16px",
									flex: 1,
								}}
								dangerouslySetInnerHTML={{ 
									__html: highlightText(
										task.title, 
										searchResult.highlights?.[task.id]?.titleMatches
									)
								}}
							/>
							<div style={{ display: "flex", gap: "8px", marginLeft: "16px" }}>
								<span 
									style={{ 
										padding: "2px 8px",
										borderRadius: "12px",
										fontSize: "11px",
										fontWeight: "500",
										background: `${getPriorityColor(task.priority)}20`,
										color: getPriorityColor(task.priority),
									}}
								>
									{task.priority}
								</span>
								<span 
									style={{ 
										padding: "2px 8px",
										borderRadius: "12px",
										fontSize: "11px",
										fontWeight: "500",
										background: `${getStatusColor(task.status)}20`,
										color: getStatusColor(task.status),
									}}
								>
									{task.status}
								</span>
							</div>
						</div>

						{/* Task Description */}
						<p 
							style={{ 
								margin: "0 0 12px 0", 
								color: "#9ca3af", 
								fontSize: "14px",
								lineHeight: "1.4",
							}}
							dangerouslySetInnerHTML={{ 
								__html: highlightText(
									task.description, 
									searchResult.highlights?.[task.id]?.descriptionMatches
								)
							}}
						/>

						{/* Task Meta */}
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#6b7280" }}>
								<span>Type: {task.type}</span>
								{task.assignedTo && <span>Assigned to: {task.assignedTo}</span>}
								{task.dependencies.length > 0 && (
									<span>Dependencies: {task.dependencies.length}</span>
								)}
							</div>
							<div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#6b7280" }}>
								<span>Created: {formatDate(task.createdAt)}</span>
								<span>Updated: {formatDate(task.updatedAt)}</span>
							</div>
						</div>

						{/* Show relevance score if this is a text search result */}
						{searchResult.query.q && (
							<div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
								Relevance score calculated based on title and description matches
							</div>
						)}
					</div>
				))}
			</div>

			{/* Pagination */}
			{searchResult.query.offset && searchResult.query.limit && searchResult.total > searchResult.query.limit && (
				<div style={{ 
					marginTop: "20px", 
					display: "flex", 
					justifyContent: "center", 
					gap: "8px" 
				}}>
					<button
						type="button"
						disabled={searchResult.query.offset === 0}
						style={{
							padding: "8px 16px",
							borderRadius: "6px",
							border: "1px solid #374151",
							background: searchResult.query.offset === 0 ? "#1f2937" : "#374151",
							color: "#f9fafb",
							fontSize: "14px",
							cursor: searchResult.query.offset === 0 ? "not-allowed" : "pointer",
							opacity: searchResult.query.offset === 0 ? 0.5 : 1,
						}}
					>
						← Previous
					</button>
					<span style={{ 
						padding: "8px 16px", 
						color: "#9ca3af", 
						fontSize: "14px",
						display: "flex",
						alignItems: "center"
					}}>
						Page {Math.floor(searchResult.query.offset / searchResult.query.limit) + 1} of {Math.ceil(searchResult.total / searchResult.query.limit)}
					</span>
					<button
						type="button"
						disabled={searchResult.query.offset + searchResult.query.limit >= searchResult.total}
						style={{
							padding: "8px 16px",
							borderRadius: "6px",
							border: "1px solid #374151",
							background: searchResult.query.offset + searchResult.query.limit >= searchResult.total ? "#1f2937" : "#374151",
							color: "#f9fafb",
							fontSize: "14px",
							cursor: searchResult.query.offset + searchResult.query.limit >= searchResult.total ? "not-allowed" : "pointer",
							opacity: searchResult.query.offset + searchResult.query.limit >= searchResult.total ? 0.5 : 1,
						}}
					>
						Next →
					</button>
				</div>
			)}
		</div>
	);
}
