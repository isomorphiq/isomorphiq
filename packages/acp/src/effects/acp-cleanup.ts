import { Effect } from "effect";
import type { AcpSession } from "../acp-session.ts";
import { cleanupAcpSession } from "../acp-session.ts";

export const acpCleanupEffect = (session: AcpSession) =>
    Effect.promise(() => cleanupAcpSession(session));
