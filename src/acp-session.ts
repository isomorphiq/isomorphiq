import { ACPConnectionManager, type ACPConnectionResult } from "./acp-connection.ts";

export interface AcpSession {
	sessionId: string;
	connection: ACPConnectionResult["connection"];
	taskClient: ACPConnectionResult["taskClient"];
	processResult: ACPConnectionResult["processResult"];
	profile: string;
	taskId: string | undefined;
	context: Record<string, unknown> | undefined;
	createdAt: Date;
}

/**
 * Start a new ACP session for a given profile/context.
 */
export async function startAcpSession(
	profile: string,
	context?: Record<string, unknown>,
	taskId?: string,
): Promise<AcpSession> {
	const result = await ACPConnectionManager.createConnection();
	return {
		sessionId: result.sessionId,
		connection: result.connection,
		taskClient: result.taskClient,
		processResult: result.processResult,
		profile,
		taskId,
		context,
		createdAt: new Date(),
	};
}

/**
 * Send a prompt turn on an existing ACP session.
 */
export async function sendPromptOnSession(session: AcpSession, prompt: string): Promise<unknown> {
	return ACPConnectionManager.sendPrompt(
		session.connection,
		session.sessionId,
		prompt,
		session.taskClient,
	);
}

/**
 * Wait for completion on an existing ACP session.
 */
export async function waitForSessionCompletion(
	session: AcpSession,
	timeoutMs = 30000,
	roleLabel?: string,
): Promise<{ output: string; error: string }> {
	return ACPConnectionManager.waitForTaskCompletion(
		session.taskClient,
		timeoutMs,
		roleLabel ?? session.profile,
	);
}

/**
 * Cleanup ACP session resources.
 */
export async function cleanupAcpSession(session: AcpSession): Promise<void> {
	await ACPConnectionManager.cleanupConnection(session.connection, session.processResult);
}
