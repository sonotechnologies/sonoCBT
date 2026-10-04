import { TRIAL_DAYS } from "@/lib/billing/plans";
import { eq, inArray, sql } from "drizzle-orm";
import { createStaffAccount } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import type { Db } from "@/lib/db/client";
import {
  academicSession,
  assessmentComponent,
  classArm,
  classLevel,
  enrollment,
  examAssignment,
  examSubject,
  gradeBand,
  gradingScale,
  resultBatch,
  school,
  scoreEntry,
  student,
  subject,
  subjectOffering,
  term,
  user,
} from "@/lib/db/schema";
import { WAEC_BANDS } from "@/lib/grading";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Owns, TenantScope, TenantTable } from "@/lib/tenant/scope";
import { armName, CLASS_LEVELS, stageOf } from "./defaults";

export class SetupError extends Error {}

// ─── Signup ──────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "school"
  );
}


/** Creates a school on a 30-day trial with its first admin (the proprietor). */
export async function createSchoolWithAdmin(
  db: Db,
  input: { schoolName: string; adminName: string; email: string; password: string },
) {
  const email = input.email.trim().toLowerCase();
  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (taken) throw new SetupError("That email already has a SonoCBT account. Sign in instead.");

  const base = slugify(input.schoolName);
  const existing = new Set(
    (await db.select({ slug: school.slug }).from(school).where(sql`${school.slug} like ${base + "%"}`)).map((r) => r.slug),
  );
  let slug = base;
  for (let n = 2; existing.has(slug); n++) slug = `${base}-${n}`;

  const [s] = await db
    .insert(school)
    .values({
      name: input.schoolName.trim(),
      slug,
      status: "trial",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
    })
    .returning();
  const admin = await createStaffAccount(db, {
    schoolId: s.id,
    name: input.adminName.trim(),
    email,
    password: input.password,
    roles: [{ role: "school_admin" }],
  });
  await audit(db, { schoolId: s.id, actorUserId: admin.id, action: "school.signup", entityType: "school", entityId: s.id });
  return { school: s, admin };
}

// ─── Step 1 & 2: details and branding ───────────────────────────────────────

export type SchoolDetails = {
  name: string;
  address: string;
  locality: string;
  state: string;
  phone: string;
  email: string;
  principalName: string;
};

export async function saveSchoolDetails(db: Db, schoolId: string, d: SchoolDetails) {
  const blank = (v: string) => v.trim() || null;
  await db
    .update(school)
    .set({
      name: d.name.trim(),
      address: blank(d.address),
      locality: blank(d.locality),
      state: blank(d.state),
      phone: blank(d.phone),
      email: blank(d.email)?.toLowerCase() ?? null,
      principalName: blank(d.principalName),
    })
    .where(eq(school.id, schoolId));
}

export async function saveBranding(
  db: Db,
  schoolId: string,
  b: { motto: string; brandColor: string; logoUrl?: string | null; principalSignatureUrl?: string | null },
) {
  if (!/^#[0-9a-f]{6}$/i.test(b.brandColor)) throw new SetupError("Choose a colour.");
  await db
    .update(school)
    .set({
      motto: b.motto.trim() || null,
      brandColor: b.brandColor.toUpperCase(),
      ...(b.logoUrl !== undefined ? { logoUrl: b.logoUrl } : {}),
      ...(b.principalSignatureUrl !== undefined ? { principalSignatureUrl: b.principalSignatureUrl } : {}),
    })
    .where(eq(school.id, schoolId));
}

// ─── Step 3: session, terms, weights, grading ───────────────────────────────

export type SessionInput = {
  /** "2026/2027" */
  sessionName: string;
  terms: { number: number; startsOn: string; endsOn: string }[];
  currentTerm: number;
  components: { name: string; weight: number }[];
};

export function validateSession(input: SessionInput): string | null {
  if (!/^\d{4}\/\d{4}$/.test(input.sessionName)) return "Write the session like 2026/2027.";
  const [a, b] = input.sessionName.split("/").map(Number);
  if (b !== a + 1) return "The session should span two consecutive years, like 2026/2027.";
  for (const t of input.terms) {
    if (!t.startsOn || !t.endsOn) return `Add both dates for the ${["", "1st", "2nd", "3rd"][t.number]} term.`;
    if (t.endsOn <= t.startsOn) return `The ${["", "1st", "2nd", "3rd"][t.number]} term must end after it starts.`;
  }
  const sorted = [...input.terms].sort((x, y) => x.number - y.number);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startsOn <= sorted[i - 1].endsOn) return "Terms overlap. Each term should start after the one before ends.";
  }
  const names = input.components.map((c) => c.name.trim().toLowerCase());
  if (input.components.some((c) => !c.name.trim())) return "Give every assessment a name.";
  if (new Set(names).size !== names.length) return "Each assessment needs a different name.";
  if (input.components.some((c) => !Number.isInteger(c.weight) || c.weight <= 0)) return "Weights must be whole numbers above 0.";
  const total = input.components.reduce((s, c) => s + c.weight, 0);
  if (total !== 100) return `Weights add up to ${total}. They need to add up to 100.`;
  return null;
}

export async function saveSessionAndTerms(scope: TenantScope, input: SessionInput) {
  const problem = validateSession(input);
  if (problem) throw new SetupError(problem);
  const schoolId = scope.schoolId;
  const sorted = [...input.terms].sort((x, y) => x.number - y.number);
  const names = input.components.map((c, i) => ({ name: c.name.trim(), weight: c.weight, sortOrder: i + 1 }));

  // Few, bulk statements: every query is a network round trip to the database.
  await scope.transaction((tx) =>
    tx.query(async (db, owns) => {
      const [s] = await db
        .insert(academicSession)
        .values({ schoolId, name: input.sessionName, startsOn: sorted[0].startsOn, endsOn: sorted.at(-1)!.endsOn })
        .onConflictDoUpdate({
          target: [academicSession.schoolId, academicSession.name],
          set: { startsOn: sql`excluded.starts_on`, endsOn: sql`excluded.ends_on` },
        })
        .returning({ id: academicSession.id });

      // Exactly one current session and term per school.
      await db.update(academicSession).set({ isCurrent: sql`${academicSession.id} = ${s.id}` }).where(owns(academicSession));
      await db.update(term).set({ isCurrent: false }).where(owns(term));
      const terms = await db
        .insert(term)
        .values(
          sorted.map((t, i) => ({
            schoolId,
            sessionId: s.id,
            number: t.number,
            startsOn: t.startsOn,
            endsOn: t.endsOn,
            nextResumesOn: sorted[i + 1]?.startsOn ?? null,
            isCurrent: t.number === input.currentTerm,
          })),
        )
        .onConflictDoUpdate({
          target: [term.sessionId, term.number],
          set: {
            startsOn: sql`excluded.starts_on`,
            endsOn: sql`excluded.ends_on`,
            nextResumesOn: sql`excluded.next_resumes_on`,
            isCurrent: sql`excluded.is_current`,
          },
        })
        .returning({ id: term.id });
      const termIds = terms.map((t) => t.id);

      // Assessment components for every term of the session. Components that
      // already hold scores are kept even if removed here, so no marks are lost.
      const current = await db
        .select()
        .from(assessmentComponent)
        .where(owns(assessmentComponent, inArray(assessmentComponent.termId, termIds)));
      const toInsert: (typeof assessmentComponent.$inferInsert)[] = [];
      const toUpdate: { id: string; name: string; weight: number; sortOrder: number }[] = [];
      for (const termId of termIds) {
        const mine = current.filter((c) => c.termId === termId);
        for (const c of names) {
          const match = mine.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
          if (!match) toInsert.push({ schoolId, termId, ...c });
          else if (match.name !== c.name || match.weight !== c.weight || match.sortOrder !== c.sortOrder) {
            toUpdate.push({ id: match.id, ...c });
          }
        }
      }
      if (toInsert.length) await db.insert(assessmentComponent).values(toInsert);
      for (const u of toUpdate) {
        await db
          .update(assessmentComponent)
          .set({ name: u.name, weight: u.weight, sortOrder: u.sortOrder })
          .where(owns(assessmentComponent, eq(assessmentComponent.id, u.id)));
      }
      const keep = names.map((c) => c.name.toLowerCase());
      const removed = current.filter((c) => !keep.includes(c.name.toLowerCase())).map((c) => c.id);
      if (removed.length) {
        const used = await referenced(db, owns, scoreEntry, scoreEntry.componentId, removed);
        const drop = removed.filter((id) => !used.has(id));
        if (drop.length) await db.delete(assessmentComponent).where(owns(assessmentComponent, inArray(assessmentComponent.id, drop)));
      }

      // Default WAEC-style grading scale, once.
      const [hasScale] = await db.select({ id: gradingScale.id }).from(gradingScale).where(owns(gradingScale)).limit(1);
      if (!hasScale) {
        const [scale] = await db
          .insert(gradingScale)
          .values({ schoolId, name: "WAEC (A1–F9)", isDefault: true })
          .returning({ id: gradingScale.id });
        await db.insert(gradeBand).values(WAEC_BANDS.map((b) => ({ ...b, schoolId, scaleId: scale.id })));
      }
    }),
  );
}

// ─── Step 4: classes and subjects ───────────────────────────────────────────

export type ClassesInput = {
  /** Enabled levels with their arm labels ("A", "Science"). */
  levels: { code: string; arms: string[] }[];
  subjects: { name: string; shortName?: string | null; stage: "jss" | "ss" | "all" }[];
};

export type ClassesResult = { kept: string[] };

/** Ids among `ids` that `column` of `table` refers to (one query). */
async function referenced(db: Db, owns: Owns, table: TenantTable, column: AnyPgColumn, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = (await db
    .selectDistinct({ id: column })
    .from(table as PgTable)
    .where(owns(table, inArray(column, ids)))) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Makes the school's classes and subjects match the input. Anything already in
 * use (students, results, exams) is never deleted; it is reported in `kept`.
 * Written as a handful of bulk statements so it stays quick over a slow link.
 */
export async function saveClassesAndSubjects(scope: TenantScope, input: ClassesInput): Promise<ClassesResult> {
  const kept: string[] = [];
  const schoolId = scope.schoolId;
  const levelOrder = (code: string) => {
    const i = (CLASS_LEVELS as readonly string[]).indexOf(code);
    return i === -1 ? 99 : i + 1;
  };
  if (!input.levels.some((l) => l.arms.length)) throw new SetupError("Turn on at least one class.");

  const wantedArms = new Map<string, { code: string; name: string }>(); // keyed by lower-cased arm name
  for (const l of input.levels) {
    for (const a of l.arms) {
      const name = armName(l.code, a);
      wantedArms.set(name.toLowerCase(), { code: l.code, name });
    }
  }
  const wantedSubjects = new Map<string, ClassesInput["subjects"][number] & { sortOrder: number }>();
  input.subjects.forEach((s, i) => {
    const name = s.name.trim();
    if (name && !wantedSubjects.has(name.toLowerCase())) wantedSubjects.set(name.toLowerCase(), { ...s, name, sortOrder: i + 1 });
  });

  await scope.transaction((tx) =>
    tx.query(async (db, owns) => {
      const levels = await db.select().from(classLevel).where(owns(classLevel));
      const arms = await db.select().from(classArm).where(owns(classArm));
      const subjects = await db.select().from(subject).where(owns(subject));

      // Levels
      const levelId = new Map(levels.map((l) => [l.code, l.id]));
      const newLevels = [...new Set([...wantedArms.values()].map((a) => a.code))].filter((code) => !levelId.has(code));
      if (newLevels.length) {
        const rows = await db
          .insert(classLevel)
          .values(newLevels.map((code) => ({ schoolId, code, sortOrder: levelOrder(code) })))
          .returning({ id: classLevel.id, code: classLevel.code });
        rows.forEach((r) => levelId.set(r.code, r.id));
      }

      // Arms
      const haveArms = new Set(arms.map((a) => a.name.toLowerCase()));
      const newArms = [...wantedArms].filter(([k]) => !haveArms.has(k)).map(([, a]) => a);
      if (newArms.length) {
        await db.insert(classArm).values(newArms.map((a) => ({ schoolId, name: a.name, classLevelId: levelId.get(a.code)! })));
      }
      const unwantedArms = arms.filter((a) => !wantedArms.has(a.name.toLowerCase()));
      if (unwantedArms.length) {
        const ids = unwantedArms.map((a) => a.id);
        const used = new Set<string>();
        const refs: [TenantTable, AnyPgColumn][] = [
          [student, student.classArmId],
          [enrollment, enrollment.classArmId],
          [examAssignment, examAssignment.classArmId],
          [resultBatch, resultBatch.classArmId],
        ];
        for (const [table, col] of refs) for (const id of await referenced(db, owns, table, col, ids)) used.add(id);
        kept.push(...unwantedArms.filter((a) => used.has(a.id)).map((a) => a.name));
        const drop = ids.filter((id) => !used.has(id));
        if (drop.length) await db.delete(classArm).where(owns(classArm, inArray(classArm.id, drop)));
      }
      await db
        .delete(classLevel)
        .where(owns(classLevel, sql`not exists (select 1 from ${classArm} where ${classArm.classLevelId} = ${classLevel.id})`));

      // Subjects: one upsert; existing subjects keep their ids (and marks).
      const byLower = new Map(subjects.map((s) => [s.name.toLowerCase(), s]));
      if (wantedSubjects.size) {
        await db
          .insert(subject)
          .values(
            [...wantedSubjects].map(([k, s]) => ({
              schoolId,
              name: byLower.get(k)?.name ?? s.name,
              shortName: s.shortName?.trim() || null,
              stage: s.stage,
              sortOrder: s.sortOrder,
            })),
          )
          .onConflictDoUpdate({
            target: [subject.schoolId, subject.name],
            set: { shortName: sql`excluded.short_name`, stage: sql`excluded.stage`, sortOrder: sql`excluded.sort_order` },
          });
      }
      const unwantedSubjects = subjects.filter((s) => !wantedSubjects.has(s.name.toLowerCase()));
      if (unwantedSubjects.length) {
        const ids = unwantedSubjects.map((s) => s.id);
        const used = new Set([
          ...(await referenced(db, owns, scoreEntry, scoreEntry.subjectId, ids)),
          ...(await referenced(db, owns, examSubject, examSubject.subjectId, ids)),
        ]);
        kept.push(...unwantedSubjects.filter((s) => used.has(s.id)).map((s) => s.name));
        const drop = ids.filter((id) => !used.has(id));
        if (drop.length) await db.delete(subject).where(owns(subject, inArray(subject.id, drop)));
      }

      // Offerings: every arm takes every subject of its stage. Teachers are assigned later.
      const allArms = await db
        .select({ id: classArm.id, code: classLevel.code })
        .from(classArm)
        .innerJoin(classLevel, owns(classLevel, eq(classLevel.id, classArm.classLevelId)))
        .where(owns(classArm));
      const allSubjects = await db.select({ id: subject.id, stage: subject.stage }).from(subject).where(owns(subject));
      const offerings = await db.select().from(subjectOffering).where(owns(subjectOffering));
      const want = new Set<string>();
      for (const a of allArms) {
        for (const s of allSubjects) if (s.stage === "all" || s.stage === stageOf(a.code)) want.add(`${s.id}|${a.id}`);
      }
      const have = new Set(offerings.map((o) => `${o.subjectId}|${o.classArmId}`));
      const toAdd = [...want]
        .filter((k) => !have.has(k))
        .map((k) => {
          const [subjectId, classArmId] = k.split("|");
          return { schoolId, subjectId, classArmId };
        });
      if (toAdd.length) await db.insert(subjectOffering).values(toAdd);
      const stale = offerings.filter((o) => !want.has(`${o.subjectId}|${o.classArmId}`)).map((o) => o.id);
      if (stale.length) await db.delete(subjectOffering).where(owns(subjectOffering, inArray(subjectOffering.id, stale)));
    }),
  );

  return { kept };
}

// ─── Reading setup state (for the wizard) ───────────────────────────────────

export async function getSetupState(scope: TenantScope) {
  const [sessions, terms, levels, arms, subjects, components] = await Promise.all([
    scope.findMany(academicSession),
    scope.findMany(term),
    scope.findMany(classLevel),
    scope.findMany(classArm),
    scope.findMany(subject),
    scope.findMany(assessmentComponent),
  ]);
  const current = sessions.find((s) => s.isCurrent) ?? sessions.at(-1) ?? null;
  const sessionTerms = current ? terms.filter((t) => t.sessionId === current.id).sort((a, b) => a.number - b.number) : [];
  const currentTerm = terms.find((t) => t.isCurrent) ?? null;
  const termComponents = currentTerm
    ? components.filter((c) => c.termId === currentTerm.id).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  return {
    session: current,
    terms: sessionTerms,
    currentTerm,
    components: termComponents,
    levels: levels.sort((a, b) => a.sortOrder - b.sortOrder),
    arms,
    subjects: subjects.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  };
}

export async function completeOnboarding(db: Db, schoolId: string) {
  await db.update(school).set({ onboardingCompletedAt: new Date() }).where(eq(school.id, schoolId));
}

/** Class arms with their level, in school order. */
export async function armsOf(scope: TenantScope) {
  return scope.query((db, owns) =>
    db
      .select({ id: classArm.id, name: classArm.name, levelCode: classLevel.code, levelOrder: classLevel.sortOrder })
      .from(classArm)
      .innerJoin(classLevel, owns(classLevel, eq(classLevel.id, classArm.classLevelId)))
      .where(owns(classArm))
      .orderBy(classLevel.sortOrder, classArm.name),
  );
}

