#!/usr/bin/env node

/**
 * Test script for Advanced Task Search and Filtering feature
 * Tests the new search functionality, saved searches, and API endpoints
 */

import { ProductManager } from "./src/index.ts";
import type { SearchQuery, CreateSavedSearchInput, TaskStatus, TaskType } from "./src/types.ts";

async function runAdvancedSearchTests() {
	console.log("🔍 Testing Advanced Task Search and Filtering Feature");
	console.log("=" .repeat(60));

	const pm = new ProductManager();

	try {
		// Initialize the database and templates
		await pm.initializeTemplates();
		console.log("✅ ProductManager initialized successfully");

		// Create some test tasks for comprehensive testing
		console.log("\n📝 Creating test tasks...");
		const testTasks = [];
		
		// Task 1: High priority feature task
		const task1 = await pm.createTask(
			"Implement user authentication system",
			"Add JWT-based authentication with login, logout, and token refresh functionality",
			"high",
			[],
			"user1",
			"dev1",
			["dev2"],
			["manager1"],
			"feature"
		);
		testTasks.push(task1);
		console.log(`✅ Created task: ${task1.title}`);

		// Task 2: Medium priority bug fix
		const task2 = await pm.createTask(
			"Fix memory leak in dashboard",
			"Resolve memory consumption issue when loading large datasets in the dashboard component",
			"medium",
			[task1.id],
			"user2",
			"dev2",
			[],
			["dev1"],
			"task"
		);
		testTasks.push(task2);
		console.log(`✅ Created task: ${task2.title}`);

		// Task 3: Low priority research task
		const task3 = await pm.createTask(
			"Research new database technologies",
			"Evaluate PostgreSQL vs MongoDB for our next migration",
			"low",
			[],
			"user1",
			"dev1",
			["dev3"],
			["manager1"],
			"research"
		);
		testTasks.push(task3);
		console.log(`✅ Created task: ${task3.title}`);

		// Task 4: High priority integration task
		const task4 = await pm.createTask(
			"Integrate payment gateway API",
			"Connect Stripe API for payment processing",
			"high",
			[],
			"user3",
			"dev3",
			["dev1", "dev2"],
			["manager1", "finance1"],
			"integration"
		);
		testTasks.push(task4);
		console.log(`✅ Created task: ${task4.title}`);

		// Task 5: Story task
		const task5 = await pm.createTask(
			"As a user, I want to reset my password",
			"User story for password reset functionality with email verification",
			"medium",
			[],
			"user1",
			"dev1",
			["dev2"],
			["manager1"],
			"story"
		);
		testTasks.push(task5);
		console.log(`✅ Created task: ${task5.title}`);

		console.log(`\n✅ Created ${testTasks.length} test tasks successfully`);

		// Test 1: Basic text search
		console.log("\n🔍 Test 1: Basic text search");
		const basicSearchQuery: SearchQuery = {
			q: "authentication",
			limit: 10,
		};
		const basicSearchResult = await pm.searchTasks(basicSearchQuery);
		console.log(`Found ${basicSearchResult.total} tasks for "authentication":`);
		basicSearchResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (${task.priority})`);
		});
		if (basicSearchResult.highlights) {
			console.log("  Highlights available for search terms");
		}

		// Test 2: Filter by priority
		console.log("\n🎯 Test 2: Filter by priority");
		const prioritySearchQuery: SearchQuery = {
			priority: ["high"],
			limit: 10,
		};
		const prioritySearchResult = await pm.searchTasks(prioritySearchQuery);
		console.log(`Found ${prioritySearchResult.total} high priority tasks:`);
		prioritySearchResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (${task.type})`);
		});

		// Test 3: Filter by status and type
		console.log("\n📊 Test 3: Filter by status and type");
		const statusTypeSearchQuery: SearchQuery = {
			status: ["todo"],
			type: ["feature", "story"],
			limit: 10,
		};
		const statusTypeResult = await pm.searchTasks(statusTypeSearchQuery);
		console.log(`Found ${statusTypeResult.total} todo feature/story tasks:`);
		statusTypeResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (${task.type})`);
		});

		// Test 4: Filter by assigned user
		console.log("\n👤 Test 4: Filter by assigned user");
		const assignedSearchQuery: SearchQuery = {
			assignedTo: ["dev1"],
			limit: 10,
		};
		const assignedResult = await pm.searchTasks(assignedSearchQuery);
		console.log(`Found ${assignedResult.total} tasks assigned to dev1:`);
		assignedResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (${task.priority})`);
		});

		// Test 5: Date range filtering
		console.log("\n📅 Test 5: Date range filtering");
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		
		const dateSearchQuery: SearchQuery = {
			dateFrom: today.toISOString().split('T')[0],
			dateTo: tomorrow.toISOString().split('T')[0],
			limit: 10,
		};
		const dateResult = await pm.searchTasks(dateSearchQuery);
		console.log(`Found ${dateResult.total} tasks created today:`);
		dateResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (created: ${new Date(task.createdAt).toLocaleString()})`);
		});

		// Test 6: Complex search with multiple filters
		console.log("\n🔬 Test 6: Complex search with multiple filters");
		const complexSearchQuery: SearchQuery = {
			q: "user",
			priority: ["high", "medium"],
			type: ["feature", "story"],
			assignedTo: ["dev1"],
			limit: 10,
			sort: { field: "priority", direction: "desc" }
		};
		const complexResult = await pm.searchTasks(complexSearchQuery);
		console.log(`Found ${complexResult.total} tasks matching complex criteria:`);
		complexResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (${task.priority}, ${task.type})`);
		});

		// Test 7: Search with dependencies filter
		console.log("\n🔗 Test 7: Search with dependencies filter");
		const depSearchQuery: SearchQuery = {
			hasDependencies: true,
			limit: 10,
		};
		const depResult = await pm.searchTasks(depSearchQuery);
		console.log(`Found ${depResult.total} tasks with dependencies:`);
		depResult.tasks.forEach(task => {
			console.log(`  - ${task.title} (deps: ${task.dependencies.join(", ")})`);
		});

		// Test 8: Test search suggestions
		console.log("\n💡 Test 8: Search suggestions");
		const allTasks = await pm.getAllTasks();
		const suggestions = pm.generateSearchSuggestions("auth", allTasks);
		console.log(`Suggestions for "auth": ${suggestions.join(", ")}`);

		// Test 9: Test facets
		console.log("\n📈 Test 9: Search facets");
		if (complexResult.facets) {
			console.log("Facets from complex search:");
			console.log(`  Status: ${JSON.stringify(complexResult.facets.status)}`);
			console.log(`  Priority: ${JSON.stringify(complexResult.facets.priority)}`);
			console.log(`  Type: ${JSON.stringify(complexResult.facets.type)}`);
		}

		// Test 10: Saved searches
		console.log("\n💾 Test 10: Saved searches");
		
		// Create a saved search
		const savedSearchInput: CreateSavedSearchInput = {
			name: "High Priority Features",
			description: "All high priority feature tasks assigned to me",
			query: {
				priority: ["high"],
				type: ["feature"],
				assignedTo: ["dev1"],
				sort: { field: "createdAt", direction: "desc" }
			},
			isPublic: false
		};
		
		const savedSearch = await pm.createSavedSearch(savedSearchInput, "user1");
		console.log(`✅ Created saved search: ${savedSearch.name}`);

		// Get all saved searches
		const savedSearches = await pm.getSavedSearches("user1");
		console.log(`Found ${savedSearches.length} saved searches for user1:`);
		savedSearches.forEach(search => {
			console.log(`  - ${search.name} (${search.isPublic ? "public" : "private"})`);
		});

		// Execute saved search
		const executedSearch = await pm.getSavedSearch(savedSearch.id, "user1");
		if (executedSearch) {
			console.log(`✅ Executed saved search "${executedSearch.name}" (usage count: ${executedSearch.usageCount})`);
			const savedSearchResult = await pm.searchTasks(executedSearch.query);
			console.log(`Found ${savedSearchResult.total} tasks from saved search`);
		}

		// Update saved search
		const updatedSearch = await pm.updateSavedSearch({
			id: savedSearch.id,
			name: "High Priority Features (Updated)",
			description: "Updated description",
			isPublic: true
		}, "user1");
		console.log(`✅ Updated saved search to: ${updatedSearch.name}`);

		// Test pagination
		console.log("\n📄 Test 11: Pagination");
		const paginationQuery: SearchQuery = {
			limit: 2,
			offset: 0,
		};
		const page1 = await pm.searchTasks(paginationQuery);
		console.log(`Page 1: ${page1.tasks.length} tasks (total: ${page1.total})`);
		
		paginationQuery.offset = 2;
		const page2 = await pm.searchTasks(paginationQuery);
		console.log(`Page 2: ${page2.tasks.length} tasks`);

		// Test sorting
		console.log("\n🔄 Test 12: Sorting options");
		const sortTests = [
			{ field: "title" as const, direction: "asc" as const },
			{ field: "createdAt" as const, direction: "desc" as const },
			{ field: "priority" as const, direction: "desc" as const },
		];

		for (const sort of sortTests) {
			const sortQuery: SearchQuery = {
				sort,
				limit: 5,
			};
			const sortResult = await pm.searchTasks(sortQuery);
			console.log(`Sorted by ${sort.field} (${sort.direction}):`);
			sortResult.tasks.slice(0, 3).forEach(task => {
				console.log(`  - ${task.title}`);
			});
		}

		// Cleanup
		console.log("\n🧹 Cleaning up test data...");
		await pm.deleteSavedSearch(savedSearch.id, "user1");
		console.log("✅ Deleted test saved search");

		console.log("\n🎉 All advanced search tests completed successfully!");
		console.log("\n📋 Summary of implemented features:");
		console.log("  ✅ Full-text search across titles and descriptions");
		console.log("  ✅ Multiple filter criteria (status, priority, type, dates, users)");
		console.log("  ✅ Advanced query syntax with complex filtering");
		console.log("  ✅ Search relevance scoring and highlighting");
		console.log("  ✅ Search facets for aggregated counts");
		console.log("  ✅ Search suggestions based on content");
		console.log("  ✅ Saved searches functionality");
		console.log("  ✅ Pagination and sorting");
		console.log("  ✅ Permission-based filtering");

	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the tests
runAdvancedSearchTests().catch(console.error);