import "server-only";
import { and, count, eq, gte, like } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { featureBlock } from "@/lib/billing/gate";
import { auditLog } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";
import { geminiProvider } from "./gemini";
import { AiError, type AiProvider } from "./provider";

export { AiError };

export function aiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export function getAi(): AiProvider {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("AI isn't set up yet. Add GEMINI_API_KEY to the server settings.", "not_configured");
  return geminiProvider(key, process.env.GEMINI_MODEL);
}

const DAILY_LIMIT = () => Number(process.env.AI_DAILY_LIMIT) || 60;

/**
 * Runs an AI task for a school, within its daily allowance (free-tier friendly),
 * and records it in the audit log (never the content).
 */
export async function runAi<T>(scope: TenantScope, actorUserId: string, task: string, fn: (ai: AiProvider) => Promise<T>): Promise<T> {
  // Photo import and the AI assistant (writing, tagging, marking suggestions) are paid features.
  const blocked = await featureBlock(scope, task === "photoImport" ? "photo_import" : "ai_assistant");
  if (blocked) throw new AiError(blocked, "plan");
  const ai = getAi();
  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ n }] = await scope.query((db) =>
    db
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.schoolId, scope.schoolId), like(auditLog.action, "ai.%"), gte(auditLog.createdAt, since))),
  );
  if (n >= DAILY_LIMIT()) throw new AiError(`Your school has used today's ${DAILY_LIMIT()} AI requests. Try again tomorrow.`, "limit");
  const result = await fn(ai);
  await scope.query((db) => audit(db, { schoolId: scope.schoolId, actorUserId, action: `ai.${task}`, entityType: "ai", meta: { provider: ai.name } }));
  return result;
}
