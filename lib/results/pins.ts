import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { academicSession, resultPin, school, student, term, user } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";
import { formatPin, generatePin, hashPin, isWellFormedPin, normalisePin } from "./pin";
import { ResultsError } from "./pipeline";

export const MAX_BATCH = 500;

function guard(scope: TenantScope, actor: Actor) {
  if (!can(actor, "resultPins.manage", { schoolId: scope.schoolId })) throw new ResultsError("Only the school admin manages result PINs.");
}

/** "GFA" for serials: the admission-number prefix most students share, or the school's initials. */
async function serialPrefix(scope: TenantScope): Promise<string> {
  const [row] = await scope.query((db, owns) =>
    db
      .select({ p: sql<string>`upper(substring(${student.admissionNo} from '^([A-Za-z]{2,4})[/-]'))`, n: sql<number>`count(*)::int` })
      .from(student)
      .where(owns(student))
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`))
      .limit(1),
  );
  if (row?.p) return row.p;
  const [s] = await scope.query((db) => db.select({ name: school.name }).from(school).where(eq(school.id, scope.schoolId)));
  return (s?.name ?? "SCH").toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join("") || "SCH";
}

/**
 * Makes a batch of result-checker PINs for a term. The PINs themselves are
 * returned once, here, for printing: only their hashes are kept.
 */
export async function generatePinBatch(scope: TenantScope, actor: Actor, input: { termId: string; count: number; maxUses: number }, now = new Date()) {
  guard(scope, actor);
  const { termId } = input;
  const count = Math.floor(input.count);
  const maxUses = Math.floor(input.maxUses);
  if (!(count >= 1 && count <= MAX_BATCH)) throw new ResultsError(`Make between 1 and ${MAX_BATCH} PINs at a time.`);
  if (!(maxUses >= 1 && maxUses <= 20)) throw new ResultsError("Each PIN can work 1 to 20 times.");
  const [tm] = await scope.query((db, owns) =>
    db
      .select({ number: term.number, session: academicSession.name })
      .from(term)
      .innerJoin(academicSession, owns(academicSession, eq(academicSession.id, term.sessionId)))
      .where(owns(term, eq(term.id, termId))),
  );
  if (!tm) throw new ResultsError("Choose a term.");

  // Serials like GFA-3T26-000149: school, term + session end year, running number.
  const stem = `${await serialPrefix(scope)}-${tm.number}T${tm.session.slice(-2)}-`;
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");

  return scope.transaction(async (tx) => {
    const used = await tx.query((db, owns) =>
      db
        .select({ serial: resultPin.serial, batch: resultPin.batch })
        .from(resultPin)
        .where(owns(resultPin, like(resultPin.serial, `${stem}%`))),
    );
    let next = Math.max(0, ...used.map((u) => Number(u.serial.slice(stem.length)) || 0)) + 1;
    const sameDay = await tx.query((db, owns) =>
      db.selectDistinct({ batch: resultPin.batch }).from(resultPin).where(owns(resultPin, like(resultPin.batch, `B-${day}-%`))),
    );
    const batch = `B-${day}-${sameDay.length + 1}`;

    const pins: { serial: string; pin: string }[] = [];
    const hashes = new Set<string>();
    while (pins.length < count) {
      const pin = generatePin();
      const h = hashPin(scope.schoolId, pin);
      if (hashes.has(h)) continue;
      hashes.add(h);
      pins.push({ serial: `${stem}${String(next++).padStart(6, "0")}`, pin });
    }
    // A clash with an older PIN is astronomically unlikely; if it happens, replace those.
    const clash = await tx.findMany(resultPin, inArray(resultPin.pinHash, [...hashes]));
    for (const c of clash) {
      const i = pins.findIndex((p) => hashPin(scope.schoolId, p.pin) === c.pinHash);
      let pin = generatePin();
      while (hashes.has(hashPin(scope.schoolId, pin))) pin = generatePin();
      pins[i] = { ...pins[i], pin };
    }
    await tx.insert(
      resultPin,
      pins.map((p) => ({ termId, serial: p.serial, pinHash: hashPin(scope.schoolId, p.pin), usesLeft: maxUses, maxUses, batch, createdBy: actor.id })),
    );
    await tx.query((db) =>
      audit(db, { schoolId: scope.schoolId, actorUserId: actor.id, action: "result_pins.generate", entityType: "term", entityId: termId, meta: { batch, count, maxUses } }),
    );
    return { batch, termLabel: `${["", "1st", "2nd", "3rd"][tm.number]} Term ${tm.session}`, maxUses, pins: pins.map((p) => ({ serial: p.serial, pin: formatPin(p.pin) })) };
  });
}

/** Batches for a term with how many PINs have been used. */
export async function pinBatches(scope: TenantScope, actor: Actor, termId: string) {
  guard(scope, actor);
  return scope.query((db, owns) =>
    db
      .select({
        batch: sql<string>`coalesce(${resultPin.batch}, 'Earlier PINs')`,
        createdAt: sql<Date>`min(${resultPin.createdAt})`,
        by: sql<string | null>`max(${user.name})`,
        count: sql<number>`count(*)::int`,
        used: sql<number>`count(*) filter (where ${resultPin.usesLeft} < ${resultPin.maxUses})::int`,
        usedUp: sql<number>`count(*) filter (where ${resultPin.usesLeft} <= 0)::int`,
        first: sql<string>`min(${resultPin.serial})`,
        last: sql<string>`max(${resultPin.serial})`,
      })
      .from(resultPin)
      .leftJoin(user, eq(user.id, resultPin.createdBy))
      .where(owns(resultPin, eq(resultPin.termId, termId)))
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`)),
  );
}

/** Usage log: every PIN that has been used for this term, newest first. */
export async function pinUsage(scope: TenantScope, actor: Actor, termId: string, limit = 200) {
  guard(scope, actor);
  return scope.query((db, owns) =>
    db
      .select({
        serial: resultPin.serial,
        batch: resultPin.batch,
        uses: sql<number>`(${resultPin.maxUses} - ${resultPin.usesLeft})::int`,
        maxUses: resultPin.maxUses,
        lastUsedAt: resultPin.lastUsedAt,
        studentName: sql<string | null>`case when ${student.id} is null then null else ${student.firstName} || ' ' || ${student.lastName} end`,
        admissionNo: student.admissionNo,
      })
      .from(resultPin)
      .leftJoin(student, eq(student.id, resultPin.studentId))
      .where(owns(resultPin, and(eq(resultPin.termId, termId), sql`${resultPin.usesLeft} < ${resultPin.maxUses}`)))
      .orderBy(desc(resultPin.lastUsedAt))
      .limit(limit),
  );
}

/**
 * For printing a sheet: checks every PIN given really is this school's, with
 * that serial, so the sheet can't be used to print made-up cards.
 */
export async function checkPinsForSheet(scope: TenantScope, actor: Actor, pins: { serial: string; pin: string }[]) {
  guard(scope, actor);
  if (!pins.length || pins.length > MAX_BATCH) throw new ResultsError("Nothing to print.");
  if (pins.some((p) => !isWellFormedPin(p.pin))) throw new ResultsError("Those PINs don't look right.");
  const rows = await scope.findMany(resultPin, inArray(resultPin.pinHash, pins.map((p) => hashPin(scope.schoolId, p.pin))));
  const bySerial = new Map(rows.map((r) => [r.serial, r]));
  for (const p of pins) {
    const r = bySerial.get(p.serial);
    if (!r || r.pinHash !== hashPin(scope.schoolId, p.pin)) throw new ResultsError("Those PINs don't belong to this school.");
  }
  const t = rows[0];
  const [tm] = await scope.query((db, owns) =>
    db
      .select({ number: term.number, session: academicSession.name })
      .from(term)
      .innerJoin(academicSession, owns(academicSession, eq(academicSession.id, term.sessionId)))
      .where(owns(term, eq(term.id, t.termId))),
  );
  return {
    termLabel: `${["", "1st", "2nd", "3rd"][tm.number]} Term ${tm.session}`,
    pins: pins.map((p) => ({ serial: p.serial, pin: formatPin(normalisePin(p.pin)), maxUses: bySerial.get(p.serial)!.maxUses })),
  };
}
