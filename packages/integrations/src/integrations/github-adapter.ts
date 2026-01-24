import type { Task } from "@isomorphiq/tasks";
import { BaseIntegrationAdapter } from "./base-adapter.ts";
import type { ExternalTask, IntegrationHealth, IntegrationSettings } from "./types.ts";

type GitHubSettings = NonNullable<IntegrationSettings["github"]>;

type GitHubLabel = { name: string };
type GitHubUser = { login: string };
type GitHubIssue = {
	number: number;
	title: string;
	body?: string;
	state: string;
	labels?: GitHubLabel[];
	assignee?: GitHubUser | null;
	html_url: string;
	created_at: string;
	updated_at: string;
	milestone?: { title?: string };
};

type GitHubPullRequest = GitHubIssue & {
	head: { ref: string };
	base: { ref: string };
	merged?: boolean;
};

type GitHubWebhookPayload = {
	headers?: Record<string, string>;
	body?: Record<string, unknown>;
	action?: string;
	issue?: GitHubIssue;
	pull_request?: GitHubPullRequest;
	comment?: { body?: string };
};

/**
 * GitHub integration adapter
 */
export class GitHubIntegration extends BaseIntegrationAdapter {
	private apiUrl = "https://api.github.com";
	private webhookSecret?: string;

	constructor() {
		super("github", "GitHub");
	}

	protected async onInitialize(): Promise<void> {
		if (!this.config) {
			throw new Error("GitHub integration not configured");
		}

		// Validate GitHub-specific settings
		const githubSettings = this.config.settings.github;
		if (!githubSettings?.repository) {
			throw new Error("GitHub repository is required");
		}

		// Set webhook secret if available
		this.webhookSecret = this.config.credentials.webhookSecret || undefined;

		// Test the connection
		const isConnected = await this.onTestConnection();
		if (!isConnected) {
			throw new Error("Failed to connect to GitHub API");
		}

		console.log(`[GITHUB] Initialized for repository: ${githubSettings.repository}`);
	}

	protected async onTestConnection(): Promise<boolean> {
		try {
			const response = await this.makeGitHubRequest("GET", "/user");
			return response.ok;
		} catch (error) {
			console.error("[GITHUB] Connection test failed:", error);
			return false;
		}
	}

	protected async onHealthCheck(): Promise<boolean> {
		try {
			const response = await this.makeGitHubRequest("GET", "/rate_limit");
			return response.ok;
		} catch (error) {
			console.error("[GITHUB] Health check failed:", error);
			return false;
		}
	}

	protected async onSyncInbound(lastSyncAt?: Date): Promise<ExternalTask[]> {
		const githubSettings = this.getGitHubSettings();
		const [owner, repo] = githubSettings.repository.split("/");

		const externalTasks: ExternalTask[] = [];

		try {
			// Sync issues if enabled
			if (githubSettings.syncIssues) {
				const issues = await this.fetchIssues(owner, repo, lastSyncAt);
				externalTasks.push(...issues);
			}

			// Sync pull requests if enabled
			if (githubSettings.syncPullRequests) {
				const prs = await this.fetchPullRequests(owner, repo, lastSyncAt);
				externalTasks.push(...prs);
			}

			return externalTasks;
		} catch (error) {
			console.error("[GITHUB] Inbound sync failed:", error);
			throw error;
		}
	}

	protected async onSyncSingleTask(task: Task): Promise<{ created: boolean; updated: boolean }> {
		const githubSettings = this.getGitHubSettings();
		const [owner, repo] = githubSettings.repository.split("/");

		try {
			// Check if issue already exists
			const existingIssue = await this.findIssueByTaskId(task.id);

			if (existingIssue) {
				// Update existing issue
				await this.updateIssue(owner, repo, existingIssue.number, task);
				return { created: false, updated: true };
			} else {
				// Create new issue
				await this.createIssue(owner, repo, task);
				return { created: true, updated: false };
			}
		} catch (error) {
			console.error(`[GITHUB] Failed to sync task ${task.id}:`, error);
			throw error;
		}
	}

	protected async onCreateExternalTask(task: Task): Promise<ExternalTask> {
		const githubSettings = this.getGitHubSettings();
		const [owner, repo] = githubSettings.repository.split("/");

		const issue = await this.createIssue(owner, repo, task);

		return this.createExternalTaskFromTask(task, issue.number.toString(), issue.html_url);
	}

	protected async onUpdateExternalTask(task: Task, externalId: string): Promise<ExternalTask> {
		const githubSettings = this.getGitHubSettings();
		const [owner, repo] = githubSettings.repository.split("/");

		const issue = await this.updateIssue(owner, repo, parseInt(externalId, 10), task);

		return this.createExternalTaskFromTask(task, externalId, issue.html_url);
	}

	protected async onDeleteExternalTask(externalId: string): Promise<void> {
		const githubSettings = this.getGitHubSettings();
		const [owner, repo] = githubSettings.repository.split("/");

		await this.closeIssue(owner, repo, parseInt(externalId, 10));
	}

	protected async onHandleWebhook(payload: Record<string, unknown>): Promise<void> {
		const webhook = payload as GitHubWebhookPayload;
		const eventType = webhook.headers?.["x-github-event"];
		const body = webhook.body;

		console.log(`[GITHUB] Processing webhook event: ${eventType}`);

		switch (eventType) {
			case "issues":
				await this.handleIssuesWebhook(body);
				break;
			case "issue_comment":
				await this.handleIssueCommentWebhook(body);
				break;
			case "pull_request":
				await this.handlePullRequestWebhook(body);
				break;
			default:
				console.log(`[GITHUB] Unhandled webhook event: ${eventType}`);
		}
	}

	protected async onCleanup(): Promise<void> {
		this.webhookSecret = undefined;
	}

	private getGitHubSettings(): GitHubSettings {
		if (!this.config?.settings.github) {
			throw new Error("GitHub integration not configured");
		}
		return this.config.settings.github;
	}

	// GitHub API methods
	private async makeGitHubRequest(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<Response> {
		const token = this.config?.credentials.accessToken;
		if (!token) {
			throw new Error("GitHub access token not configured");
		}

		const url = `${this.apiUrl}${path}`;
		const headers: HeadersInit = {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "TaskManager/1.0.0",
			"Content-Type": "application/json",
		};

		const options: RequestInit = {
			method,
			headers,
		};

		if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url, options);

		if (!response.ok && response.status === 401) {
			throw new Error("GitHub authentication failed. Check your access token.");
		}

		if (!response.ok && response.status === 403) {
			const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
			if (rateLimitRemaining === "0") {
				const resetTime = response.headers.get("x-ratelimit-reset");
				throw new Error(`GitHub rate limit exceeded. Resets at ${resetTime}`);
			}
		}

		return response;
	}

	private async fetchIssues(owner: string, repo: string, since?: Date): Promise<ExternalTask[]> {
		const issues: ExternalTask[] = [];
		const page = 1;
		const perPage = 100;

		const query = since ? `+updated:>${since.toISOString().split("T")[0]}` : "";
		const path = `/search/issues?q=repo:${owner}/${repo}+type:issue${query}&per_page=${perPage}&page=${page}`;

		try {
			const response = await this.makeGitHubRequest("GET", path);
			const data = await response.json();

			for (const item of (data.items as GitHubIssue[] | undefined) || []) {
				const externalTask: ExternalTask = {
					id: `github-issue-${item.number}`,
					source: "github",
					sourceId: item.number.toString(),
					title: item.title,
					description: item.body || "",
					status: this.mapGitHubStatusToTaskStatus(item.state),
					priority: this.mapGitHubLabelsToPriority(item.labels || []),
					assignee: item.assignee?.login,
					labels: item.labels?.map((label) => label.name) || [],
					url: item.html_url,
					createdAt: new Date(item.created_at),
					updatedAt: new Date(item.updated_at),
					additionalData: {
						type: "issue",
						number: item.number,
						state: item.state,
						milestone: item.milestone?.title,
					},
				};

				issues.push(externalTask);
			}

			console.log(`[GITHUB] Fetched ${issues.length} issues`);
			return issues;
		} catch (error) {
			console.error("[GITHUB] Failed to fetch issues:", error);
			throw error;
		}
	}

	private async fetchPullRequests(
		owner: string,
		repo: string,
		since?: Date,
	): Promise<ExternalTask[]> {
		const prs: ExternalTask[] = [];
		const page = 1;
		const perPage = 100;

		const path = since
			? `/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}&since=${since.toISOString()}`
			: `/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;

		try {
			const response = await this.makeGitHubRequest("GET", path);
			const data = await response.json();

			for (const pr of (data as GitHubPullRequest[] | undefined) || []) {
				const externalTask: ExternalTask = {
					id: `github-pr-${pr.number}`,
					source: "github",
					sourceId: pr.number.toString(),
					title: pr.title,
					description: pr.body || "",
					status: this.mapGitHubStatusToTaskStatus(pr.state),
					priority: this.mapGitHubLabelsToPriority(pr.labels || []),
					assignee: pr.assignee?.login,
					labels: pr.labels?.map((label) => label.name) || [],
					url: pr.html_url,
					createdAt: new Date(pr.created_at),
					updatedAt: new Date(pr.updated_at),
					additionalData: {
						type: "pull_request",
						number: pr.number,
						state: pr.state,
						head: pr.head.ref,
						base: pr.base.ref,
					},
				};

				prs.push(externalTask);
			}

			console.log(`[GITHUB] Fetched ${prs.length} pull requests`);
			return prs;
		} catch (error) {
			console.error("[GITHUB] Failed to fetch pull requests:", error);
			throw error;
		}
	}

	private async createIssue(owner: string, repo: string, task: Task): Promise<GitHubIssue> {
		const githubSettings = this.getGitHubSettings();

		const issueData: Record<string, unknown> = {
			title: task.title,
			body: task.description,
			labels: this.mapTaskToGitHubLabels(task),
		};

		// Add assignee if mapping exists
		if (task.assignedTo && githubSettings.assigneeMapping?.[task.assignedTo]) {
			issueData.assignees = [githubSettings.assigneeMapping[task.assignedTo]];
		}

		const response = await this.makeGitHubRequest(
			"POST",
			`/repos/${owner}/${repo}/issues`,
			issueData,
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Failed to create GitHub issue: ${error.message}`);
		}

		return await response.json();
	}

	private async updateIssue(
		owner: string,
		repo: string,
		issueNumber: number,
		task: Task,
	): Promise<GitHubIssue> {
		const githubSettings = this.getGitHubSettings();

		const updateData: Record<string, unknown> = {
			title: task.title,
			body: task.description,
			state: this.mapTaskStatusToGitHubState(task.status),
			labels: this.mapTaskToGitHubLabels(task),
		};

		// Update assignee if mapping exists
		if (task.assignedTo && githubSettings.assigneeMapping?.[task.assignedTo]) {
			updateData.assignees = [githubSettings.assigneeMapping[task.assignedTo]];
		}

		const response = await this.makeGitHubRequest(
			"PATCH",
			`/repos/${owner}/${repo}/issues/${issueNumber}`,
			updateData,
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Failed to update GitHub issue: ${error.message}`);
		}

		return await response.json();
	}

	private async closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
		const response = await this.makeGitHubRequest(
			"PATCH",
			`/repos/${owner}/${repo}/issues/${issueNumber}`,
			{
				state: "closed",
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Failed to close GitHub issue: ${error.message}`);
		}
	}

	private async findIssueByTaskId(taskId: string): Promise<GitHubIssue | null> {
		const githubSettings = this.getGitHubSettings();
		const [owner, repo] = githubSettings.repository.split("/");

		// Search for issue with task ID in body or title
		const query = `repo:${owner}/${repo}+${taskId}+in:title,body`;
		const response = await this.makeGitHubRequest(
			"GET",
			`/search/issues?q=${encodeURIComponent(query)}`,
		);

		if (!response.ok) {
			return null;
		}

		const data = await response.json();
		return data.items?.[0] || null;
	}

	// Mapping methods
	private mapGitHubStatusToTaskStatus(gitHubState: string): string {
		switch (gitHubState) {
			case "open":
				return "todo";
			case "closed":
				return "done";
			default:
				return "todo";
		}
	}

	private mapTaskStatusToGitHubState(taskStatus: string): string {
		switch (taskStatus) {
			case "todo":
				return "open";
			case "in-progress":
				return "open";
			case "done":
				return "closed";
			default:
				return "open";
		}
	}

	private mapGitHubLabelsToPriority(labels: GitHubLabel[]): string {
		const priorityLabels = labels.filter(
			(label) =>
				label.name.toLowerCase().includes("priority") ||
				label.name.toLowerCase().includes("urgent") ||
				label.name.toLowerCase().includes("critical"),
		);

		if (
			priorityLabels.some(
				(label) =>
					label.name.toLowerCase().includes("high") ||
					label.name.toLowerCase().includes("critical"),
			)
		) {
			return "high";
		}

		if (priorityLabels.some((label) => label.name.toLowerCase().includes("medium"))) {
			return "medium";
		}

		return "low";
	}

	private mapTaskToGitHubLabels(task: Task): string[] {
		const labels: string[] = [];

		// Add priority label
		labels.push(`priority: ${task.priority}`);

		// Add status label
		labels.push(`status: ${task.status}`);

		// Add custom labels from settings
		const githubSettings = this.getGitHubSettings();
		if (githubSettings.labelMapping?.[task.status]) {
			labels.push(githubSettings.labelMapping[task.status]);
		}

		return labels;
	}

	// Webhook handlers
	private async handleIssuesWebhook(payload: Record<string, unknown>): Promise<void> {
		const action = payload.action;
		const issue = payload.issue as GitHubIssue;

		console.log(`[GITHUB] Issues webhook: ${action} for issue #${issue.number}`);

		// Handle different issue actions
		switch (action) {
			case "opened":
				// Create task from new issue
				await this.handleIssueCreated(issue);
				break;
			case "closed":
				// Mark corresponding task as done
				await this.handleIssueClosed(issue);
				break;
			case "reopened":
				// Mark corresponding task as todo
				await this.handleIssueReopened(issue);
				break;
			case "edited":
				// Update corresponding task
				await this.handleIssueUpdated(issue);
				break;
			case "assigned":
				// Update task assignment
				await this.handleIssueAssigned(issue);
				break;
		}
	}

	private async handleIssueCreated(issue: GitHubIssue): Promise<void> {
		// This would emit an event to create a task from the issue
		console.log(`[GITHUB] Issue created: ${issue.title} (#${issue.number})`);
		// Implementation would depend on the event system integration
	}

	private async handleIssueClosed(issue: GitHubIssue): Promise<void> {
		// This would emit an event to update the corresponding task status to "done"
		console.log(`[GITHUB] Issue closed: ${issue.title} (#${issue.number})`);
		// Implementation would depend on the event system integration
	}

	private async handleIssueReopened(issue: GitHubIssue): Promise<void> {
		// This would emit an event to update the corresponding task status to "todo"
		console.log(`[GITHUB] Issue reopened: ${issue.title} (#${issue.number})`);
		// Implementation would depend on the event system integration
	}

	private async handleIssueUpdated(issue: GitHubIssue): Promise<void> {
		// This would emit an event to update the corresponding task
		console.log(`[GITHUB] Issue updated: ${issue.title} (#${issue.number})`);
		// Implementation would depend on the event system integration
	}

	private async handleIssueAssigned(issue: GitHubIssue): Promise<void> {
		// This would emit an event to update the task assignment
		console.log(
			`[GITHUB] Issue assigned: ${issue.title} (#${issue.number}) to ${issue.assignee?.login}`,
		);
		// Implementation would depend on the event system integration
	}

	private async handleIssueCommentWebhook(payload: Record<string, unknown>): Promise<void> {
		const action = payload.action;
		const issue = payload.issue as GitHubIssue;

		console.log(`[GITHUB] Issue comment ${action}: ${issue.title} (#${issue.number})`);

		// Handle comment actions if needed
		// This could be used to process commands or add comments to task descriptions
	}

	private async handlePullRequestWebhook(payload: Record<string, unknown>): Promise<void> {
		const action = payload.action;
		const pr = payload.pull_request as GitHubPullRequest;

		console.log(`[GITHUB] Pull request ${action}: ${pr.title} (#${pr.number})`);

		// Handle PR actions similar to issues
		switch (action) {
			case "opened":
				await this.handlePullRequestCreated(pr);
				break;
			case "closed":
				if (pr.merged) {
					await this.handlePullRequestMerged(pr);
				} else {
					await this.handlePullRequestClosed(pr);
				}
				break;
		}
	}

	private async handlePullRequestCreated(pr: GitHubPullRequest): Promise<void> {
		console.log(`[GITHUB] PR created: ${pr.title} (#${pr.number})`);
		// Implementation would depend on the event system integration
	}

	private async handlePullRequestMerged(pr: GitHubPullRequest): Promise<void> {
		console.log(`[GITHUB] PR merged: ${pr.title} (#${pr.number})`);
		// Implementation would depend on the event system integration
	}

	private async handlePullRequestClosed(pr: GitHubPullRequest): Promise<void> {
		console.log(`[GITHUB] PR closed: ${pr.title} (#${pr.number})`);
		// Implementation would depend on the event system integration
	}

	protected async getMetrics(): Promise<IntegrationHealth["metrics"]> {
		// GitHub adapter currently does not accumulate sync metrics; return zeros.
		return {
			syncsCompleted: 0,
			syncsFailed: 0,
			averageSyncTime: 0,
			lastSyncDuration: 0,
		};
	}
}
