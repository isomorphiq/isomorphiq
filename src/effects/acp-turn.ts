import { Effect } from "effect";
import type { AcpSession } from "../acp-session.ts";
import { sendPromptOnSession, waitForSessionCompletion } from "../acp-session.ts";

interface AcpTurnParams {
	session: AcpSession;
	prompt: string;
	timeoutMs?: number;
}

/**
 * Effect: send a prompt and wait for completion on an existing ACP session.
 * Does NOT cleanup the session; compose with cleanup effect as needed.
 */
export const acpTurnEffect = ({ session, prompt, timeoutMs = 30000 }: AcpTurnParams) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => sendPromptOnSession(session, prompt));
		const result = yield* Effect.promise(() =>
			waitForSessionCompletion(session, timeoutMs, session.profile),
		);
		return result;
	});
