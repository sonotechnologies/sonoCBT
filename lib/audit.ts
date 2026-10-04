import type { Db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export type AuditEntry = {
  schoolId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
};

/** Who did what. Never put passwords, PINs or tokens in `meta`. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({ ...e, entityId: e.entityId ?? null });
}
