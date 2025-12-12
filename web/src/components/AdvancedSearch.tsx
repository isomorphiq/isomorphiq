import { useState, useEffect } from "react";
import type { SearchQuery, SearchResult, SavedSearch } from "../../../src/types.ts";

interface AdvancedSearchProps {
	onSearch: (query: SearchQuery) => void;
	searchResult?: SearchResult;
	isLoading?: boolean;
}

// Mock API calls - replace with actual API integration
const mockSearchSuggestions = async (query: string): Promise<string[]> => {
	// Mock suggestions based on common task terms
	const commonTerms = ["feature", "bug", "fix", "implement", "refactor", "test", "documentation", "api", "ui", "backend"];
	return commonTerms.filter(term => term.includes(query.toLowerCase())).slice(0, 5);
};

const mockGetSavedSearches = async (): Promise<SavedSearch[]> => {
	// Mock saved searches
	return [
		{
			id: "1",
			name: "High Priority Tasks",
			query: { priority: ["high"] },
			createdBy: "user1",
			isPublic: false,
			createdAt: new Date("2024-01-15"),
			updatedAt: new Date("2024-01-15"),
			usageCount: 5,
		},
		{
			id: "2", 
			name: "My In-Progress Tasks",
			query: { status: ["in-progress"] },
			createdBy: "user1",
			isPublic: false,
			createdAt: new Date("2024-01-10"),
			updatedAt: new Date("2024-01-10"),
			usageCount: 12,
		},
	];
};

const mockCreateSavedSearch = async (name: string, query: SearchQuery): Promise<SavedSearch> => {
	return {
		id: Date.now().toString(),
		name,
		query,
		createdBy: "user1",
		isPublic: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		usageCount: 0,
	};
};

export function AdvancedSearch({ onSearch, searchResult, isLoading }: AdvancedSearchProps) {
	const [searchQuery, setSearchQuery] = useState<SearchQuery>({});
	const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
	const [showSavedSearches, setShowSavedSearches] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [searchName, setSearchName] = useState("");
	const [showSaveDialog, setShowSaveDialog] = useState(false);
	const [queryText, setQueryText] = useState("");

	// Load saved searches on mount
	useEffect(() => {
		mockGetSavedSearches().then(setSavedSearches);
	}, []);

	// Generate suggestions when query text changes
	useEffect(() => {
		if (queryText.trim().length >= 2) {
			const timer = setTimeout(() => {
				mockSearchSuggestions(queryText).then(setSuggestions);
			}, 300);
			return () => clearTimeout(timer);
		} else {
			setSuggestions([]);
		}
	}, [queryText]);

	const handleSearch = () => {
		const query: SearchQuery = {
			q: queryText.trim() || undefined,
			...searchQuery,
		};
		onSearch(query);
	};

	const handleLoadSavedSearch = (savedSearch: SavedSearch) => {
		setSearchQuery(savedSearch.query);
		setQueryText(savedSearch.query.q || "");
		onSearch(savedSearch.query);
		setShowSavedSearches(false);
	};

	const handleSaveSearch = async () => {
		if (!searchName.trim()) return;

		const query: SearchQuery = {
			q: queryText.trim() || undefined,
			...searchQuery,
		};

		try {
			const newSearch = await mockCreateSavedSearch(searchName.trim(), query);
			setSavedSearches(prev => [newSearch, ...prev]);
			setSearchName("");
			setShowSaveDialog(false);
		} catch (error) {
			console.error("Failed to save search:", error);
		}
	};

	const clearAllFilters = () => {
		setSearchQuery({});
		setQueryText("");
		onSearch({});
	};

	const updateQueryFilter = (key: keyof SearchQuery, value: unknown) => {
		setSearchQuery(prev => ({
			...prev,
			[key]: value,
		}));
	};

	return (
		<div style={{ marginBottom: "24px" }}>
			{/* Header with saved searches */}
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
				<h3 style={{ margin: 0, color: "#f9fafb", fontSize: "18px" }}>Advanced Task Search</h3>
				<div style={{ display: "flex", gap: "8px" }}>
					<button
						type="button"
						onClick={() => setShowSavedSearches(!showSavedSearches)}
						style={{
							padding: "8px 16px",
							borderRadius: "6px",
							border: "1px solid #374151",
							background: "#374151",
							color: "#f9fafb",
							fontSize: "14px",
							cursor: "pointer",
						}}
					>
						📋 Saved Searches ({savedSearches.length})
					</button>
					<button
						type="button"
						onClick={() => setShowSaveDialog(true)}
						disabled={!queryText.trim() && Object.keys(searchQuery).length === 0}
						style={{
							padding: "8px 16px",
							borderRadius: "6px",
							border: "1px solid #374151",
							background: (!queryText.trim() && Object.keys(searchQuery).length === 0) ? "#1f2937" : "#10b981",
							color: "#f9fafb",
							fontSize: "14px",
							cursor: (!queryText.trim() && Object.keys(searchQuery).length === 0) ? "not-allowed" : "pointer",
						}}
					>
						💾 Save Search
					</button>
				</div>
			</div>

			{/* Main search bar */}
			<div style={{ position: "relative", marginBottom: "16px" }}>
				<input
					type="text"
					placeholder="Search tasks... (use quotes for exact phrases, boolean operators: AND, OR, NOT)"
					value={queryText}
					onChange={(e) => setQueryText(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSearch()}
					style={{
						width: "100%",
						padding: "12px 16px",
						borderRadius: "8px",
						border: "1px solid #374151",
						background: "#1f2937",
						color: "#f9fafb",
						fontSize: "16px",
					}}
				/>
				{suggestions.length > 0 && (
					<div
						style={{
							position: "absolute",
							top: "100%",
							left: 0,
							right: 0,
							background: "#1f2937",
							border: "1px solid #374151",
							borderTop: "none",
							borderRadius: "0 0 8px 8px",
							maxHeight: "200px",
							overflowY: "auto",
							zIndex: 10,
						}}
					>
						{suggestions.map((suggestion, index) => (
							<div
								key={index}
								onClick={() => setQueryText(suggestion)}
								style={{
									padding: "8px 16px",
									cursor: "pointer",
									borderBottom: "1px solid #374151",
									color: "#f9fafb",
								}}
								onMouseEnter={(e) => e.currentTarget.style.background = "#374151"}
								onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
							>
								{suggestion}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Search actions */}
			<div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
				<button
					type="button"
					onClick={handleSearch}
					disabled={isLoading}
					style={{
						padding: "10px 20px",
						borderRadius: "6px",
						border: "none",
						background: "#3b82f6",
						color: "#ffffff",
						fontSize: "14px",
						fontWeight: "500",
						cursor: isLoading ? "not-allowed" : "pointer",
						opacity: isLoading ? 0.7 : 1,
					}}
				>
					{isLoading ? "🔄 Searching..." : "🔍 Search"}
				</button>
				<button
					type="button"
					onClick={() => setShowAdvanced(!showAdvanced)}
					style={{
						padding: "10px 20px",
						borderRadius: "6px",
						border: "1px solid #374151",
						background: showAdvanced ? "#3b82f6" : "#374151",
						color: "#f9fafb",
						fontSize: "14px",
						cursor: "pointer",
					}}
				>
					{showAdvanced ? "▼ Hide" : "▶ Show"} Advanced Filters
				</button>
				<button
					type="button"
					onClick={clearAllFilters}
					style={{
						padding: "10px 20px",
						borderRadius: "6px",
						border: "1px solid #dc2626",
						background: "#dc2626",
						color: "#ffffff",
						fontSize: "14px",
						cursor: "pointer",
					}}
				>
					✖ Clear All
				</button>
			</div>

			{/* Advanced filters */}
			{showAdvanced && (
				<div
					style={{
						padding: "20px",
						borderRadius: "8px",
						border: "1px solid #374151",
						background: "#1f2937",
						marginBottom: "16px",
					}}
				>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
							gap: "16px",
						}}
					>
						{/* Status Filter */}
						<div>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Status
							</label>
							<select
								multiple
								value={searchQuery.status || []}
								onChange={(e) => {
									const values = Array.from(e.target.selectedOptions, (option) => option.value);
									updateQueryFilter("status", values.length > 0 ? values : undefined);
								}}
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
									minHeight: "80px",
								}}
							>
								<option value="todo">Todo</option>
								<option value="in-progress">In Progress</option>
								<option value="done">Done</option>
							</select>
						</div>

						{/* Priority Filter */}
						<div>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Priority
							</label>
							<select
								multiple
								value={searchQuery.priority || []}
								onChange={(e) => {
									const values = Array.from(e.target.selectedOptions, (option) => option.value);
									updateQueryFilter("priority", values.length > 0 ? values : undefined);
								}}
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
									minHeight: "80px",
								}}
							>
								<option value="high">High</option>
								<option value="medium">Medium</option>
								<option value="low">Low</option>
							</select>
						</div>

						{/* Type Filter */}
						<div>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Type
							</label>
							<select
								multiple
								value={searchQuery.type || []}
								onChange={(e) => {
									const values = Array.from(e.target.selectedOptions, (option) => option.value);
									updateQueryFilter("type", values.length > 0 ? values : undefined);
								}}
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
									minHeight: "80px",
								}}
							>
								<option value="feature">Feature</option>
								<option value="story">Story</option>
								<option value="task">Task</option>
								<option value="integration">Integration</option>
								<option value="research">Research</option>
							</select>
						</div>

						{/* Date Range */}
						<div>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Created From
							</label>
							<input
								type="date"
								value={searchQuery.dateFrom || ""}
								onChange={(e) => updateQueryFilter("dateFrom", e.target.value || undefined)}
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
								}}
							/>
						</div>

						<div>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Created To
							</label>
							<input
								type="date"
								value={searchQuery.dateTo || ""}
								onChange={(e) => updateQueryFilter("dateTo", e.target.value || undefined)}
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
								}}
							/>
						</div>

						{/* Dependencies Filter */}
						<div>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Has Dependencies
							</label>
							<select
								value={searchQuery.hasDependencies === undefined ? "" : searchQuery.hasDependencies.toString()}
								onChange={(e) => {
									const value = e.target.value;
									updateQueryFilter("hasDependencies", value === "" ? undefined : value === "true");
								}}
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
								}}
							>
								<option value="">All</option>
								<option value="true">Has Dependencies</option>
								<option value="false">No Dependencies</option>
							</select>
						</div>
					</div>

					{/* Sort Options */}
					<div style={{ marginTop: "20px", paddingTop: "20px", borderTop: "1px solid #374151" }}>
						<label style={{ display: "block", marginBottom: "12px", fontSize: "14px", color: "#9ca3af" }}>
							Sort By
						</label>
						<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
							{[
								{ field: "relevance" as const, label: "Relevance" },
								{ field: "createdAt" as const, label: "Created" },
								{ field: "updatedAt" as const, label: "Updated" },
								{ field: "title" as const, label: "Title" },
								{ field: "priority" as const, label: "Priority" },
								{ field: "status" as const, label: "Status" },
							].map(({ field, label }) => (
								<button
									key={field}
									type="button"
									onClick={() => updateQueryFilter("sort", {
										field,
										direction: searchQuery.sort?.field === field && searchQuery.sort?.direction === "asc" ? "desc" : "asc",
									})}
									style={{
										padding: "8px 16px",
										borderRadius: "6px",
										border: "1px solid #374151",
										background: searchQuery.sort?.field === field ? "#3b82f6" : "#374151",
										color: "#f9fafb",
										fontSize: "14px",
										cursor: "pointer",
									}}
								>
									{label} {searchQuery.sort?.field === field && (searchQuery.sort?.direction === "asc" ? "↑" : "↓")}
								</button>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Search Results Summary */}
			{searchResult && (
				<div style={{ marginBottom: "16px", padding: "12px", background: "#1f2937", borderRadius: "8px" }}>
					<p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
						Found {searchResult.total} tasks
						{searchResult.query.q && ` for "${searchResult.query.q}"`}
						{Object.keys(searchResult.query).filter(k => k !== "q").length > 0 && " with filters applied"}
					</p>
					
					{/* Show facets if available */}
					{searchResult.facets && (
						<div style={{ marginTop: "8px", display: "flex", gap: "16px", flexWrap: "wrap" }}>
							<span style={{ color: "#6b7280", fontSize: "12px" }}>Status:</span>
							{Object.entries(searchResult.facets.status).map(([status, count]) => (
								<span key={status} style={{ color: "#9ca3af", fontSize: "12px" }}>
									{status}: {count}
								</span>
							))}
							<span style={{ color: "#6b7280", fontSize: "12px", marginLeft: "8px" }}>Priority:</span>
							{Object.entries(searchResult.facets.priority).map(([priority, count]) => (
								<span key={priority} style={{ color: "#9ca3af", fontSize: "12px" }}>
									{priority}: {count}
								</span>
							))}
						</div>
					)}

					{/* Show suggestions if available */}
					{searchResult.suggestions && searchResult.suggestions.length > 0 && (
						<div style={{ marginTop: "8px" }}>
							<span style={{ color: "#6b7280", fontSize: "12px" }}>Suggestions: </span>
							{searchResult.suggestions.slice(0, 5).map((suggestion, index) => (
								<button
									key={index}
									type="button"
									onClick={() => setQueryText(suggestion)}
									style={{
										marginLeft: "4px",
										padding: "2px 6px",
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
				</div>
			)}

			{/* Saved Searches Modal */}
			{showSavedSearches && (
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
					onClick={() => setShowSavedSearches(false)}
				>
					<div
						style={{
							background: "#1f2937",
							borderRadius: "12px",
							padding: "24px",
							maxWidth: "600px",
							maxHeight: "500px",
							overflow: "auto",
							border: "1px solid #374151",
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<h4 style={{ margin: "0 0 16px 0", color: "#f9fafb" }}>Saved Searches</h4>
						{savedSearches.length === 0 ? (
							<p style={{ color: "#9ca3af", margin: 0 }}>No saved searches yet</p>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
								{savedSearches.map((saved) => (
									<div
										key={saved.id}
										style={{
											padding: "12px",
											background: "#374151",
											borderRadius: "8px",
											cursor: "pointer",
										}}
										onClick={() => handleLoadSavedSearch(saved)}
									>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
											<div>
												<h5 style={{ margin: "0 0 4px 0", color: "#f9fafb" }}>{saved.name}</h5>
												{saved.description && (
													<p style={{ margin: "0 0 8px 0", color: "#9ca3af", fontSize: "12px" }}>
														{saved.description}
													</p>
												)}
												<p style={{ margin: 0, color: "#6b7280", fontSize: "12px" }}>
													Query: {saved.query.q || "Filters only"}
												</p>
											</div>
											<span style={{ color: "#6b7280", fontSize: "12px" }}>
												{new Date(saved.updatedAt).toLocaleDateString()}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
						<button
							type="button"
							onClick={() => setShowSavedSearches(false)}
							style={{
								marginTop: "16px",
								padding: "8px 16px",
								borderRadius: "6px",
								border: "1px solid #374151",
								background: "#374151",
								color: "#f9fafb",
								cursor: "pointer",
							}}
						>
							Close
						</button>
					</div>
				</div>
			)}

			{/* Save Search Dialog */}
			{showSaveDialog && (
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
					onClick={() => setShowSaveDialog(false)}
				>
					<div
						style={{
							background: "#1f2937",
							borderRadius: "12px",
							padding: "24px",
							maxWidth: "400px",
							border: "1px solid #374151",
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<h4 style={{ margin: "0 0 16px 0", color: "#f9fafb" }}>Save Search</h4>
						<div style={{ marginBottom: "16px" }}>
							<label style={{ display: "block", marginBottom: "6px", fontSize: "14px", color: "#9ca3af" }}>
								Search Name
							</label>
							<input
								type="text"
								value={searchName}
								onChange={(e) => setSearchName(e.target.value)}
								placeholder="My search..."
								style={{
									width: "100%",
									padding: "8px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#111827",
									color: "#f9fafb",
									fontSize: "14px",
								}}
							/>
						</div>
						<div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
							<button
								type="button"
								onClick={() => setShowSaveDialog(false)}
								style={{
									padding: "8px 16px",
									borderRadius: "6px",
									border: "1px solid #374151",
									background: "#374151",
									color: "#f9fafb",
									cursor: "pointer",
								}}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSaveSearch}
								disabled={!searchName.trim()}
								style={{
									padding: "8px 16px",
									borderRadius: "6px",
									border: "none",
									background: "#10b981",
									color: "#ffffff",
									cursor: !searchName.trim() ? "not-allowed" : "pointer",
									opacity: !searchName.trim() ? 0.7 : 1,
								}}
							>
								Save
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}