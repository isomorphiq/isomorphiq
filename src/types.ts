export interface Task {
	id: string;
	title: string;
	description: string;
	status: TaskStatus;
	priority: "low" | "medium" | "high";
	type: TaskType;
	dependencies: string[];
	createdBy: string;
	assignedTo?: string;
	collaborators?: string[]; // Additional users who can work on this task
	watchers?: string[]; // Users who should be notified of changes
	createdAt: Date;
	updatedAt: Date;
}

export type TaskStatus = "todo" | "in-progress" | "done";
export type TaskType = "feature" | "story" | "task" | "integration" | "research";

export interface CreateTaskInput {
	title: string;
	description: string;
	dependencies?: string[];
	assignedTo?: string;
	collaborators?: string[];
	watchers?: string[];
}

export interface UpdateTaskInput {
	id: string;
	status?: TaskStatus;
	title?: string;
	description?: string;
	assignedTo?: string;
	collaborators?: string[];
	watchers?: string[];
}

// Template system interfaces
export interface TaskTemplate {
	id: string;
	name: string;
	description: string;
	category: TemplateCategory;
	titleTemplate: string;
	descriptionTemplate: string;
	priority: "low" | "medium" | "high";
	variables: TemplateVariable[];
	subtasks?: SubtaskTemplate[];
	automationRules?: AutomationRule[];
	createdAt: Date;
	updatedAt: Date;
}

export type TemplateCategory =
	| "development"
	| "testing"
	| "documentation"
	| "bug-fix"
	| "feature"
	| "maintenance"
	| "deployment"
	| "custom";

export interface TemplateVariable {
	name: string;
	type: "text" | "number" | "date" | "select" | "boolean";
	description: string;
	required: boolean;
	defaultValue?: string | number | boolean | Date | string[] | null;
	options?: string[]; // for select type
}

export interface SubtaskTemplate {
	titleTemplate: string;
	descriptionTemplate: string;
	priority?: "low" | "medium" | "high";
}

export interface AutomationRule {
	id: string;
	name: string;
	trigger: RuleTrigger;
	conditions: RuleCondition[];
	actions: RuleAction[];
	enabled: boolean;
	createdAt: Date;
}

export interface RuleTrigger {
	eventType: "task_created" | "task_status_changed" | "task_completed" | "scheduled" | "manual";
	type: "task_created" | "task_status_changed" | "task_completed" | "scheduled" | "manual";
	parameters?: Record<string, unknown>;
}

export interface RuleCondition {
	field: string;
	operator: "equals" | "not_equals" | "contains" | "not_contains" | "greater_than" | "less_than";
	value: unknown;
}

export interface RuleAction {
	type: "create_task" | "update_task" | "send_notification" | "set_priority" | "assign_user";
	parameters: Record<string, unknown>;
}

export interface CreateTaskFromTemplateInput {
	templateId: string;
	variables: Record<string, unknown>;
	subtasks?: boolean; // whether to create subtasks
}

export interface DatabaseConfig {
	path: string;
	valueEncoding: "json" | "utf8" | "binary";
}

export interface AcpClientConfig {
	protocolVersion: number;
	clientInfo: {
		name: string;
		version: string;
	};
}

export interface SessionConfig {
	cwd: string;
	mcpServers: Array<{
		name: string;
		command: string;
		args?: string[];
	}>;
}

export interface PromptMessage {
	type: "text";
	text: string;
}

export interface PromptInput {
	sessionId: string;
	prompt: PromptMessage[];
}

export interface PermissionRequest {
	permission: string;
	context?: Record<string, unknown>;
}

export interface PermissionResponse {
	outcome: "approved" | "denied";
	reason?: string;
}

export interface SessionUpdateParams {
	sessionId: string;
	updates?: Record<string, unknown>;
	update?: Record<string, unknown>;
}

export interface WriteTextFileParams {
	path: string;
	content: string;
	encoding?: "utf8" | "base64";
}

export interface WriteTextFileResult {
	success: boolean;
	path: string;
}

export interface ReadTextFileParams {
	path: string;
	encoding?: "utf8" | "base64";
}

export interface ReadTextFileResult {
	content: string;
	encoding: string;
}

export interface ListDirParams {
	path: string;
	recursive?: boolean;
}

export interface DirEntry {
	name: string;
	path: string;
	type: "file" | "directory";
	size?: number;
}

export interface ListDirResult {
	entries: DirEntry[];
}

export interface CreateTerminalParams {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export interface CreateTerminalResult {
	handle: string;
}

export interface TerminalOutputParams {
	handle: string;
}

export interface TerminalOutputResult {
	output: string;
	done: boolean;
}

export interface AcpClientInterface {
	requestPermission(params: PermissionRequest): Promise<PermissionResponse>;
	sessionUpdate(params: SessionUpdateParams): Promise<void>;
	writeTextFile(params: WriteTextFileParams): Promise<WriteTextFileResult>;
	readTextFile(params: ReadTextFileParams): Promise<ReadTextFileResult>;
	listDir(params: ListDirParams): Promise<ListDirResult>;
	createTerminal(params: CreateTerminalParams): Promise<CreateTerminalResult>;
	terminalOutput(params: TerminalOutputParams): Promise<TerminalOutputResult>;
}

export interface ProcessSpawnOptions {
	cwd?: string;
	env?: Record<string, string>;
	stdio?: "pipe" | "inherit" | "ignore";
}

export interface OpencodeCommandResult {
	success: boolean;
	output?: string;
	error?: string;
	sessionId?: string;
}

// WebSocket event types
export type WebSocketEventType =
	| "task_created"
	| "task_updated"
	| "task_deleted"
	| "task_status_changed"
	| "task_priority_changed"
	| "task_assigned"
	| "task_collaborators_updated"
	| "task_watchers_updated"
	| "tasks_list";

export interface WebSocketEvent {
	type: WebSocketEventType;
	timestamp: Date;
	data: unknown;
}

export interface TaskCreatedEvent extends WebSocketEvent {
	type: "task_created";
	data: Task;
}

export interface TaskUpdatedEvent extends WebSocketEvent {
	type: "task_updated";
	data: { task: Task; changes: Partial<Task>; updatedBy?: string };
}

export interface TaskAssignedEvent extends WebSocketEvent {
	type: "task_assigned";
	data: { task: Task; assignedTo: string; assignedBy: string };
}

export interface TaskCollaboratorsUpdatedEvent extends WebSocketEvent {
	type: "task_collaborators_updated";
	data: { task: Task; collaborators: string[]; updatedBy: string };
}

export interface TaskWatchersUpdatedEvent extends WebSocketEvent {
	type: "task_watchers_updated";
	data: { task: Task; watchers: string[]; updatedBy: string };
}

export interface TaskDeletedEvent extends WebSocketEvent {
	type: "task_deleted";
	data: { taskId: string };
}

export interface TaskStatusChangedEvent extends WebSocketEvent {
	type: "task_status_changed";
	data: { taskId: string; oldStatus: TaskStatus; newStatus: TaskStatus; task: Task };
}

export interface TaskPriorityChangedEvent extends WebSocketEvent {
	type: "task_priority_changed";
	data: { taskId: string; oldPriority: string; newPriority: string; task: Task };
}

export interface TasksListEvent extends WebSocketEvent {
	type: "tasks_list";
	data: { tasks: Task[] };
}

export interface WebSocketMessage {
	event: WebSocketEvent;
	id?: string;
}

export interface WebSocketClient {
	id: string;
	socket: unknown;
	lastPing: Date;
	subscriptions: Set<WebSocketEventType>;
	userId?: string;
}

// User management interfaces
export interface UserProfile {
	firstName?: string;
	lastName?: string;
	avatar?: string;
	bio?: string;
	timezone?: string;
	language?: string;
}

export interface UserPreferences {
	theme: "light" | "dark" | "auto";
	notifications: {
		email: boolean;
		push: boolean;
		taskAssigned: boolean;
		taskCompleted: boolean;
		taskOverdue: boolean;
	};
	dashboard: {
		defaultView: "list" | "kanban" | "calendar";
		itemsPerPage: number;
		showCompleted: boolean;
	};
}

export interface User {
	id: string;
	username: string;
	email: string;
	passwordHash: string;
	role: UserRole;
	isActive: boolean;
	isEmailVerified: boolean;
	profile: UserProfile;
	preferences: UserPreferences;
	createdAt: Date;
	updatedAt: Date;
	lastLoginAt?: Date;
	passwordChangedAt?: Date;
	failedLoginAttempts: number;
	lockedUntil?: Date;
}

export type UserRole = "admin" | "manager" | "developer" | "viewer";

export interface CreateUserInput {
	username: string;
	email: string;
	password: string;
	role?: UserRole;
	profile?: Partial<UserProfile>;
	preferences?: Partial<UserPreferences>;
}

export interface UpdateUserInput {
	id: string;
	username?: string;
	email?: string;
	role?: UserRole;
	isActive?: boolean;
	profile?: Partial<UserProfile>;
	preferences?: Partial<UserPreferences>;
}

export interface UpdateProfileInput {
	userId: string;
	profile?: Partial<UserProfile>;
	preferences?: Partial<UserPreferences>;
}

export interface ChangePasswordInput {
	userId: string;
	currentPassword: string;
	newPassword: string;
}

export interface PasswordResetRequest {
	email: string;
}

export interface PasswordResetInput {
	token: string;
	newPassword: string;
}

export interface EmailVerificationInput {
	token: string;
}

export interface PasswordResetToken {
	id: string;
	userId: string;
	token: string;
	email: string;
	expiresAt: Date;
	createdAt: Date;
	isUsed: boolean;
}

export interface EmailVerificationToken {
	id: string;
	userId: string;
	token: string;
	email: string;
	expiresAt: Date;
	createdAt: Date;
	isUsed: boolean;
}

// Automation rule engine types
export interface RuleExecutionContext {
	trigger: RuleTrigger;
	task: Task;
	relatedTasks?: Task[];
	oldStatus?: TaskStatus | undefined;
	newStatus?: TaskStatus | undefined;
	oldPriority?: string | undefined;
	newPriority?: string | undefined;
}

export interface RuleExecutionResult {
	ruleId: string;
	ruleName: string;
	success: boolean;
	result?: Record<string, unknown>;
	error?: string;
}

export interface AuthCredentials {
	username: string;
	password: string;
}

export interface AuthResult {
	success: boolean;
	user?: Omit<User, "passwordHash">;
	token?: string;
	refreshToken?: string;
	expiresIn?: number;
	error?: string;
}

export interface RefreshTokenResult {
	success: boolean;
	token?: string;
	refreshToken?: string;
	expiresIn?: number;
	error?: string;
}

export interface Session {
	id: string;
	userId: string;
	token: string;
	refreshToken: string;
	deviceInfo?: DeviceInfo;
	ipAddress?: string;
	userAgent?: string;
	createdAt: Date;
	expiresAt: Date;
	refreshExpiresAt: Date;
	isActive: boolean;
	lastAccessAt: Date;
}

export interface DeviceInfo {
	type: "desktop" | "mobile" | "tablet" | "unknown";
	os?: string;
	browser?: string;
	name?: string;
}

export interface Permission {
	resource: string;
	action: string;
	conditions?: Record<string, unknown>;
}

export type RolePermissions = {
	[K in UserRole]: Permission[];
};

export interface UserPermissions {
	userId: string;
	role: UserRole;
	permissions: Permission[];
	customPermissions?: Permission[];
}

export interface PasswordPolicy {
	minLength: number;
	requireUppercase: boolean;
	requireLowercase: boolean;
	requireNumbers: boolean;
	requireSpecialChars: boolean;
	preventReuse: number;
	maxAge: number; // days
}

// Task filtering and sorting interfaces
export interface TaskFilters {
	status?: TaskStatus[];
	priority?: Task["priority"][];
	dateFrom?: string;
	dateTo?: string;
	assignedTo?: string[];
	createdBy?: string[];
	collaborators?: string[];
	watchers?: string[];
}

export interface TaskSort {
	field: "title" | "createdAt" | "updatedAt" | "priority" | "status";
	direction: "asc" | "desc";
}

export interface TaskSearchOptions {
	query?: string;
	filters?: TaskFilters;
	sort?: TaskSort;
	limit?: number;
	offset?: number;
}

// Search query interface for API
export interface SearchQuery {
	q?: string; // Full-text search query
	status?: TaskStatus[];
	priority?: Task["priority"][];
	dateFrom?: string; // ISO date string
	dateTo?: string; // ISO date string
	limit?: number;
	offset?: number;
}

export interface SearchResult {
	tasks: Task[];
	total: number;
	query: SearchQuery;
	highlights?: { taskId: string; titleMatches?: number[]; descriptionMatches?: number[] };
}
