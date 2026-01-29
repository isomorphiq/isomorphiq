import { useState } from "react";
import type { SearchQuery, SearchResult, Task } from "@isomorphiq/tasks/types";
import { AdvancedSearch } from "../components/AdvancedSearch.tsx";
import { SearchResults } from "../components/SearchResults.tsx";

// Mock data for demonstration
const mockTasks: Task[] = [
	{
		id: "task-1",
		title: "Implement advanced search functionality",
		description: "Add comprehensive search capabilities with full-text search, filters, and saved searches to the task management system.",
		status: "in-progress",
		priority: "high",
		type: "feature",
		dependencies: ["task-2", "task-3"],
		createdBy: "user1",
		assignedTo: "user2",
		collaborators: ["user3"],
		watchers: ["user1", "user2"],
		createdAt: new Date("2024-01-15T10:00:00Z"),
		updatedAt: new Date("2024-01-20T14:30:00Z"),
	},
	{
		id: "task-2",
		title: "Design search UI components",
		description: "Create reusable React components for search interface including filters, results display, and pagination.",
		status: "done",
		priority: "medium",
		type: "task",
		dependencies: [],
		createdBy: "user1",
		assignedTo: "user3",
		createdAt: new Date("2024-01-10T09:00:00Z"),
		updatedAt: new Date("2024-01-18T16:00:00Z"),
	},
	{
		id: "task-3",
		title: "Implement backend search API",
		description: "Build the backend API endpoints for advanced search with filtering, sorting, and pagination support.",
		status: "todo",
		priority: "high",
		type: "integration",
		dependencies: [],
		createdBy: "user2",
		assignedTo: "user2",
		createdAt: new Date("2024-01-12T11:00:00Z"),
		updatedAt: new Date("2024-01-12T11:00:00Z"),
	},
	{
		id: "task-4",
		title: "Add search analytics",
		description: "Track search patterns, popular queries, and search performance metrics.",
		status: "todo",
		priority: "low",
		type: "feature",
		dependencies: ["task-1"],
		createdBy: "user1",
		assignedTo: undefined,
		createdAt: new Date("2024-01-18T15:00:00Z"),
		updatedAt: new Date("2024-01-18T15:00:00Z"),
	},
	{
		id: "task-5",
		title: "Fix search performance issues",
		description: "Optimize database queries and add caching for frequently searched terms.",
		status: "todo",
		priority: "medium",
		type: "task",
		dependencies: ["task-3"],
		createdBy: "user2",
		assignedTo: "user3",
		createdAt: new Date("2024-01-19T13:00:00Z"),
		updatedAt: new Date("2024-01-19T13:00:00Z"),
	},
];

// Mock search function
const performSearch = async (query: SearchQuery): Promise<SearchResult> => {
	// Simulate API delay
	await new Promise(resolve => setTimeout(resolve, 500));

	let filteredTasks = [...mockTasks];

	// Apply text search
	if (query.q && query.q.trim()) {
		const searchTerms = query.q.toLowerCase().split(/\s+/);
		filteredTasks = filteredTasks.filter(task => {
			const title = task.title.toLowerCase();
			const description = task.description.toLowerCase();
			return searchTerms.some(term => 
				title.includes(term) || description.includes(term)
			);
		});
	}

	// Apply filters
	if (query.status && query.status.length > 0) {
		filteredTasks = filteredTasks.filter(task => query.status!.includes(task.status));
	}

	if (query.priority && query.priority.length > 0) {
		filteredTasks = filteredTasks.filter(task => query.priority!.includes(task.priority));
	}

	if (query.type && query.type.length > 0) {
		filteredTasks = filteredTasks.filter(task => query.type!.includes(task.type));
	}

	if (query.assignedTo && query.assignedTo.length > 0) {
		filteredTasks = filteredTasks.filter(task => 
			task.assignedTo && query.assignedTo!.includes(task.assignedTo)
		);
	}

	if (query.createdBy && query.createdBy.length > 0) {
		filteredTasks = filteredTasks.filter(task => 
			query.createdBy!.includes(task.createdBy)
		);
	}

	if (query.dateFrom) {
		const fromDate = new Date(query.dateFrom);
		filteredTasks = filteredTasks.filter(task => new Date(task.createdAt) >= fromDate);
	}

	if (query.dateTo) {
		const toDate = new Date(query.dateTo);
		filteredTasks = filteredTasks.filter(task => new Date(task.createdAt) <= toDate);
	}

	if (query.hasDependencies !== undefined) {
		filteredTasks = filteredTasks.filter(task => 
			query.hasDependencies ? task.dependencies.length > 0 : task.dependencies.length === 0
		);
	}

	// Apply sorting
	if (query.sort) {
		const { field, direction } = query.sort;
		filteredTasks.sort((a, b) => {
			let comparison = 0;

			switch (field) {
				case "title":
					comparison = a.title.localeCompare(b.title);
					break;
				case "createdAt":
					comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
				case "updatedAt":
					comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
					break;
				case "priority":
					const priorityOrder = { high: 3, medium: 2, low: 1 };
					comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
					break;
				case "status":
					const statusOrder = { "todo": 1, "in-progress": 2, "done": 3 };
					comparison = statusOrder[a.status] - statusOrder[b.status];
					break;
				case "relevance":
				default:
					// For relevance, just maintain the order (in real implementation, this would use relevance scores)
					break;
			}

			return direction === "asc" ? comparison : -comparison;
		});
	} else {
		// Default sort: priority then creation date
		const priorityOrder = { high: 3, medium: 2, low: 1 };
		filteredTasks.sort((a, b) => {
			const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
			if (priorityDiff !== 0) return priorityDiff;
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});
	}

	// Apply pagination
	const total = filteredTasks.length;
	const offset = query.offset || 0;
	const limit = query.limit || 10;
	const paginatedTasks = filteredTasks.slice(offset, offset + limit);

	// Generate highlights for demo
	const highlights: Record<string, { titleMatches?: number[]; descriptionMatches?: number[] }> = {};
	if (query.q && query.q.trim()) {
		paginatedTasks.forEach(task => {
			const titleIndex = task.title.toLowerCase().indexOf(query.q!.toLowerCase());
			const descIndex = task.description.toLowerCase().indexOf(query.q!.toLowerCase());
			
			if (titleIndex !== -1) highlights[task.id] = { titleMatches: [titleIndex] };
			if (descIndex !== -1) {
				highlights[task.id] = { 
					...highlights[task.id], 
					descriptionMatches: [descIndex] 
				};
			}
		});
	}

	// Generate facets
	const statusCounts = { "todo": 0, "in-progress": 0, "done": 0 };
	const priorityCounts = { "high": 0, "medium": 0, "low": 0 };
	const typeCounts = {
		"feature": 0,
		"story": 0,
		"task": 0,
		"implementation": 0,
		"integration": 0,
		"testing": 0,
		"research": 0,
	};
	const assignedToCounts: Record<string, number> = {};
	const createdByCounts: Record<string, number> = {};

	mockTasks.forEach(task => {
		statusCounts[task.status]++;
		priorityCounts[task.priority]++;
		typeCounts[task.type]++;
		
		if (task.assignedTo) {
			assignedToCounts[task.assignedTo] = (assignedToCounts[task.assignedTo] || 0) + 1;
		}
		
		createdByCounts[task.createdBy] = (createdByCounts[task.createdBy] || 0) + 1;
	});

	// Generate suggestions
	const suggestions = query.q ? [
		"search functionality",
		"UI components",
		"backend API",
		"performance optimization",
	] : [];

	return {
		tasks: paginatedTasks,
		total,
		query,
		highlights: Object.keys(highlights).length > 0 ? highlights : undefined,
		facets: {
			status: statusCounts,
			priority: priorityCounts,
			type: typeCounts,
			assignedTo: assignedToCounts,
			createdBy: createdByCounts,
		},
		suggestions: suggestions.length > 0 ? suggestions : undefined,
	};
};

export function AdvancedSearchDemo() {
	const [searchResult, setSearchResult] = useState<SearchResult | undefined>();
	const [isLoading, setIsLoading] = useState(false);
	const [selectedTask, setSelectedTask] = useState<Task | undefined>();

	const handleSearch = async (query: SearchQuery) => {
		setIsLoading(true);
		try {
			const result = await performSearch(query);
			setSearchResult(result);
		} catch (error) {
			console.error("Search failed:", error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleTaskClick = (task: Task) => {
		setSelectedTask(task);
	};

	return (
		<div style={{ 
			minHeight: "100vh", 
			background: "#111827", 
			color: "#f9fafb",
			padding: "20px"
		}}>
			<div style={{ maxWidth: "1200px", margin: "0 auto" }}>
				{/* Page Header */}
				<div style={{ marginBottom: "32px", textAlign: "center" }}>
					<h1 style={{ 
						margin: 0, 
						fontSize: "32px", 
						fontWeight: "700", 
						marginBottom: "8px" 
					}}>
						Advanced Task Search
					</h1>
					<p style={{ 
						margin: 0, 
						fontSize: "16px", 
						color: "#9ca3af" 
					}}>
						Comprehensive search functionality with full-text search, filters, and saved searches
					</p>
				</div>

				{/* Search Component */}
				<AdvancedSearch 
					onSearch={handleSearch}
					searchResult={searchResult}
					isLoading={isLoading}
				/>

				{/* Search Results */}
				{searchResult && (
					<SearchResults 
						searchResult={searchResult}
						isLoading={isLoading}
						onTaskClick={handleTaskClick}
					/>
				)}

				{/* Task Detail Modal */}
				{selectedTask && (
					<div
						style={{
							position: "fixed",
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							background: "rgba(0, 0, 0, 0.5)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							zIndex: 20,
						}}
						onClick={() => setSelectedTask(undefined)}
					>
						<div
							style={{
								background: "#1f2937",
								borderRadius: "12px",
								padding: "24px",
								maxWidth: "600px",
								maxHeight: "80vh",
								overflow: "auto",
								border: "1px solid #374151",
							}}
							onClick={(e) => e.stopPropagation()}
						>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "16px" }}>
								<h2 style={{ margin: 0, color: "#f9fafb" }}>{selectedTask.title}</h2>
								<button
									type="button"
									onClick={() => setSelectedTask(undefined)}
									style={{
										background: "none",
										border: "none",
										color: "#9ca3af",
										fontSize: "20px",
										cursor: "pointer",
									}}
								>
									×
								</button>
							</div>
							
							<div style={{ marginBottom: "16px" }}>
								<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
									Status: <span style={{ color: "#f9fafb" }}>{selectedTask.status}</span>
								</p>
								<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
									Priority: <span style={{ color: "#f9fafb" }}>{selectedTask.priority}</span>
								</p>
								<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
									Type: <span style={{ color: "#f9fafb" }}>{selectedTask.type}</span>
								</p>
								<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
									Assigned to: <span style={{ color: "#f9fafb" }}>{selectedTask.assignedTo || "Unassigned"}</span>
								</p>
								<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
									Created: <span style={{ color: "#f9fafb" }}>{new Date(selectedTask.createdAt).toLocaleDateString()}</span>
								</p>
								<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
									Updated: <span style={{ color: "#f9fafb" }}>{new Date(selectedTask.updatedAt).toLocaleDateString()}</span>
								</p>
								{selectedTask.dependencies.length > 0 && (
									<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "14px" }}>
										Dependencies: <span style={{ color: "#f9fafb" }}>{selectedTask.dependencies.join(", ")}</span>
									</p>
								)}
							</div>
							
							<div>
								<h3 style={{ margin: "0 0 8px 0", color: "#f9fafb", fontSize: "16px" }}>Description</h3>
								<p style={{ margin: 0, color: "#9ca3af", lineHeight: "1.5" }}>
									{selectedTask.description}
								</p>
							</div>
						</div>
					</div>
				)}

				{/* Feature List */}
				<div style={{ marginTop: "48px", padding: "24px", background: "#1f2937", borderRadius: "12px" }}>
					<h3 style={{ margin: "0 0 16px 0", color: "#f9fafb" }}>Features Implemented</h3>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>🔍 Full-Text Search</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								Search across task titles and descriptions with relevance scoring and highlighting
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>🎚️ Advanced Filtering</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								Filter by status, priority, type, assignee, date ranges, and dependencies
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>💾 Saved Searches</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								Save frequently used search queries for quick access
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>📊 Search Facets</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								See aggregated counts and drill down by categories
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>🔄 Sorting Options</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								Sort results by relevance, date, priority, or custom fields
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>📄 Pagination</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								Efficiently navigate through large result sets
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>💡 Search Suggestions</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								Get intelligent suggestions based on existing task content
							</p>
						</div>
						<div>
							<h4 style={{ margin: "0 0 8px 0", color: "#3b82f6" }}>🎯 Result Highlighting</h4>
							<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
								See matching terms highlighted in search results
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
