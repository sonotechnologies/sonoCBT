import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  academicSession,
  classArm,
  enrollment,
  reportCardCode,
  reportCardExtras,
  resultBatch,
  school,
  scoreEntry,
  student,
  subject,
  term,
  user,
} from "@/lib/db/schema";
import { termLabel, TERM_ORDINAL } from "@/lib/format";
import { computeClassResults, gradeFor, round } from "@/lib/grading";
import type { TenantScope } from "@/lib/tenant/scope";
import { AFFECTIVE, PSYCHOMOTOR } from "./extras-model";
import { getScale, listComponents, studentsInArm } from "./pipeline";

export type Rating = { key: string; name: string; value: number | null };

export type ReportCard = {
  school: {
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    motto: string | null;
    logoUrl: string | null;
    brandColor: string | null;
    principalName: string | null;
    principalSignatureUrl: string | null;
  };
  student: {
    id: string;
    name: string;
    /** "OKAFOR, Chiamaka Adaeze" — the way report sheets print it. */
    formalName: string;
    admissionNo: string;
    photoUrl: string | null;
    gender: string | null;
    age: number | null;
  };
  classArmName: string;
  termLabel: string;
  termNumber: number;
  sessionName: string;
  components: { id: string; name: string; weight: number }[];
  subjects: {
    name: string;
    components: { name: string; value: number | null }[];
    total: number;
    grade: string;
    remark: string;
    position: number;
    classAverage: number;
    highest: number;
    lowest: number;
  }[];
  average: number;
  total: number;
  position: number;
  numberInClass: number;
  /** Mean of everyone's averages. */
  classAverage: number;
  overall: { grade: string; remark: string };
  affective: Rating[];
  psychomotor: Rating[];
  formTeacherRemark: string | null;
  formTeacherName: string | null;
  principalRemark: string | null;
  daysPresent: number | null;
  daysOpened: number | null;
  nextResumesOn: string | null;
  released: boolean;
  /** When the class's results were released ("Result issued"). */
  issuedOn: Date | null;
  /** The verify code printed on the card (only once released). */
  verifyCode: string | null;
  /** 3rd term only: each term's subject totals and the annual average. */
  cumulative: {
    terms: string[];
    subjects: { name: string; totals: (number | null)[]; annualAverage: number }[];
    annualAverage: number;
  } | null;
};

export type ReportCardResult =
  | { status: "released"; card: ReportCard }
  | { status: "not_released"; termLabel: string }
  | { status: "no_results"; termLabel: string };

/** The class arm a student was in for a term (falls back to their current arm). */
export async function classArmForTerm(scope: TenantScope, studentId: string, termId: string): Promise<string | null> {
  const e = await scope.findFirst(enrollment, and(eq(enrollment.studentId, studentId), eq(enrollment.termId, termId)));
  if (e) return e.classArmId;
  return (await scope.findFirst(student, eq(student.id, studentId)))?.classArmId ?? null;
}

export async function isReleased(scope: TenantScope, termId: string, classArmId: string): Promise<boolean> {
  const batch = await scope.findFirst(resultBatch, and(eq(resultBatch.termId, termId), eq(resultBatch.classArmId, classArmId)));
  return batch?.status === "released";
}

export async function getTermLabel(scope: TenantScope, termId: string): Promise<{ label: string; nextResumesOn: string | null }> {
  const t = await termInfo(scope, termId);
  return { label: t?.label ?? "", nextResumesOn: t?.nextResumesOn ?? null };
}

async function termInfo(scope: TenantScope, termId: string) {
  const [row] = await scope.query((db, owns) =>
    db
      .select({ id: term.id, number: term.number, sessionId: term.sessionId, sessionName: academicSession.name, nextResumesOn: term.nextResumesOn })
      .from(term)
      .innerJoin(academicSession, owns(academicSession, eq(academicSession.id, term.sessionId)))
      .where(owns(term, eq(term.id, termId))),
  );
  return row ? { ...row, label: termLabel(row.number, row.sessionName) } : null;
}

/** "GFA" from admission numbers like "GFA/2021/0147"; otherwise the school's initials ("CMC" for Crestview Model College). */
function codePrefix(name: string, admissionNo: string): string {
  const fromAdmission = /^([A-Za-z]{2,4})[/-]/.exec(admissionNo.trim())?.[1];
  if (fromAdmission) return fromAdmission.toUpperCase();
  const words = name.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).slice(0, 3);
  return words.slice(0, 3).map((w) => w[0]).join("");
}

// Crockford base32 without I, L, O, U: easy to read off paper.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomChunk(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return s;
}

/** Codes for these students' cards, creating any that are missing. */
async function ensureCodes(scope: TenantScope, schoolName: string, termId: string, people: { id: string; admissionNo: string }[]): Promise<Map<string, string>> {
  if (!people.length) return new Map();
  const studentIds = people.map((p) => p.id);
  const existing = await scope.findMany(reportCardCode, and(eq(reportCardCode.termId, termId), inArray(reportCardCode.studentId, studentIds))!);
  const map = new Map(existing.map((c) => [c.studentId, c.code]));
  for (const { id: studentId, admissionNo } of people.filter((p) => !map.has(p.id))) {
    const prefix = codePrefix(schoolName, admissionNo) || "SNC";
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `${prefix}-${randomChunk(4)}-${randomChunk(4)}`;
      const [row] = await scope.query((db) =>
        db.insert(reportCardCode).values({ schoolId: scope.schoolId, termId, studentId, code }).onConflictDoNothing().returning(),
      );
      if (row) {
        map.set(studentId, row.code);
        break;
      }
      // Lost a race for the same card: use the one that won.
      const won = await scope.findFirst(reportCardCode, and(eq(reportCardCode.termId, termId), eq(reportCardCode.studentId, studentId))!);
      if (won) {
        map.set(studentId, won.code);
        break;
      }
    }
  }
  return map;
}

function ageOn(dob: string | null, on: Date): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age--;
  return age >= 0 && age < 100 ? age : null;
}

const cap = (s: string | null | undefined) => (s ? s[0].toUpperCase() + s.slice(1) : null);

/**
 * Every report card for a class arm and term, worked out together so the
 * single card, the class PDF, the parent's view and the verify page all agree.
 * Unreleased results are only built when `allowUnreleased` (staff preview).
 */
export async function buildReportCards(
  scope: TenantScope,
  termId: string,
  classArmId: string,
  opts: { studentIds?: string[]; allowUnreleased?: boolean } = {},
): Promise<{ released: boolean; cards: ReportCard[]; termLabel: string }> {
  const info = await termInfo(scope, termId);
  if (!info) return { released: false, cards: [], termLabel: "" };
  const batch = await scope.findFirst(resultBatch, and(eq(resultBatch.termId, termId), eq(resultBatch.classArmId, classArmId)));
  const released = batch?.status === "released";
  if (!released && !opts.allowUnreleased) return { released, cards: [], termLabel: info.label };

  const [students, components, scale, [sch], arm, subjects] = await Promise.all([
    studentsInArm(scope, termId, classArmId),
    listComponents(scope, termId),
    getScale(scope),
    scope.query((db) => db.select().from(school).where(eq(school.id, scope.schoolId))),
    scope.findFirst(classArm, eq(classArm.id, classArmId)),
    scope.findMany(subject),
  ]);
  let classmates = students.map((s) => s.id);
  // A student moved out of this arm since still gets their own card.
  for (const id of opts.studentIds ?? []) {
    if (!classmates.includes(id)) {
      const extra = await scope.findFirst(student, eq(student.id, id));
      if (extra) {
        students.push(extra);
        classmates = [...classmates, id];
      }
    }
  }
  const [scores, extras, teacher] = await Promise.all([
    classmates.length ? scope.findMany(scoreEntry, and(eq(scoreEntry.termId, termId), inArray(scoreEntry.studentId, classmates))!) : [],
    classmates.length ? scope.findMany(reportCardExtras, and(eq(reportCardExtras.termId, termId), inArray(reportCardExtras.studentId, classmates))!) : [],
    arm?.formTeacherId ? scope.query((db) => db.select({ name: user.name }).from(user).where(eq(user.id, arm.formTeacherId!))) : [],
  ]);
  const results = computeClassResults(
    scores.map((s) => ({ studentId: s.studentId, subjectId: s.subjectId, componentId: s.componentId, value: s.value })),
    scale.bands,
  );
  const everyAverage = [...results.students.values()].map((r) => r.average);
  const classAverage = everyAverage.length ? round(everyAverage.reduce((a, b) => a + b, 0) / everyAverage.length, 1) : 0;
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const wanted = opts.studentIds ? students.filter((s) => opts.studentIds!.includes(s.id)) : students;
  const withResults = wanted.filter((s) => results.students.has(s.id));
  const codes = released ? await ensureCodes(scope, sch.name, termId, withResults) : new Map<string, string>();
  const cumulative = info.number === 3 ? await cumulativeTotals(scope, info.sessionId, withResults.map((s) => s.id)) : null;
  const issuedOn = released ? (batch?.releasedAt ?? null) : null;

  const cards = withResults.map((me): ReportCard => {
    const mine = results.students.get(me.id)!;
    const ex = extras.find((e) => e.studentId === me.id);
    const rows = [...mine.subjects].sort((a, b) => {
      const [x, y] = [subjectById.get(a.subjectId), subjectById.get(b.subjectId)];
      return (x?.sortOrder ?? 0) - (y?.sortOrder ?? 0) || (x?.name ?? "").localeCompare(y?.name ?? "");
    });
    const overall = gradeFor(mine.average, scale.bands);
    const cum = cumulative?.get(me.id);
    return {
      school: {
        name: sch.name,
        slug: sch.slug,
        address: sch.address && sch.state && !sch.address.toLowerCase().includes(sch.state.toLowerCase()) ? `${sch.address}, ${sch.state}` : sch.address || sch.state || null,
        phone: sch.phone,
        email: sch.email,
        motto: sch.motto,
        logoUrl: sch.logoUrl,
        brandColor: sch.brandColor,
        principalName: sch.principalName,
        principalSignatureUrl: sch.principalSignatureUrl,
      },
      student: {
        id: me.id,
        name: [me.firstName, me.otherNames, me.lastName].filter(Boolean).join(" "),
        formalName: `${me.lastName.toUpperCase()}, ${[me.firstName, me.otherNames].filter(Boolean).join(" ")}`,
        admissionNo: me.admissionNo,
        photoUrl: me.photoUrl,
        gender: cap(me.gender),
        age: ageOn(me.dateOfBirth, issuedOn ?? new Date()),
      },
      classArmName: arm?.name ?? "",
      termLabel: info.label,
      termNumber: info.number,
      sessionName: info.sessionName,
      components: components.map((c) => ({ id: c.id, name: c.name, weight: c.weight })),
      subjects: rows.map((s) => ({
        name: subjectById.get(s.subjectId)?.name ?? "",
        components: components.map((c) => ({ name: c.name, value: s.components[c.id] ?? null })),
        total: s.total,
        grade: s.grade,
        remark: s.remark,
        position: s.position,
        classAverage: s.classAverage,
        highest: s.highest,
        lowest: s.lowest,
      })),
      average: mine.average,
      total: mine.total,
      position: mine.position,
      numberInClass: results.numberInClass,
      classAverage,
      overall: { grade: overall?.grade ?? "—", remark: overall?.remark ?? "" },
      affective: AFFECTIVE.map((i) => ({ ...i, value: ex?.affective?.[i.key] ?? null })),
      psychomotor: PSYCHOMOTOR.map((i) => ({ ...i, value: ex?.psychomotor?.[i.key] ?? null })),
      formTeacherRemark: ex?.formTeacherRemark ?? null,
      formTeacherName: teacher[0]?.name ?? null,
      principalRemark: ex?.principalRemark ?? null,
      daysPresent: ex?.daysPresent ?? null,
      daysOpened: ex?.daysOpened ?? null,
      nextResumesOn: info.nextResumesOn,
      released,
      issuedOn,
      verifyCode: codes.get(me.id) ?? null,
      cumulative: cum
        ? (() => {
            const subs = rows.map((s) => {
              const id = s.subjectId;
              const totals = [cum.byTerm[0].get(id) ?? null, cum.byTerm[1].get(id) ?? null, s.total];
              const have = totals.filter((x): x is number => x !== null);
              return { name: subjectById.get(id)?.name ?? "", totals, annualAverage: round(have.reduce((a, b) => a + b, 0) / have.length, 1) };
            });
            return {
              terms: [1, 2, 3].map((n) => `${TERM_ORDINAL[n]} term`),
              subjects: subs,
              annualAverage: round(subs.reduce((a, s) => a + s.annualAverage, 0) / (subs.length || 1), 1),
            };
          })()
        : null,
    };
  });
  return { released, cards, termLabel: info.label };
}

/**
 * Per student, their subject totals for the 1st and 2nd terms of a session
 * (only terms whose results were released for the class they were in).
 */
async function cumulativeTotals(scope: TenantScope, sessionId: string, studentIds: string[]) {
  if (!studentIds.length) return null;
  const earlier = (await scope.findMany(term, eq(term.sessionId, sessionId))).filter((t) => t.number < 3).sort((a, b) => a.number - b.number);
  const out = new Map<string, { byTerm: [Map<string, number>, Map<string, number>] }>();
  for (const id of studentIds) out.set(id, { byTerm: [new Map(), new Map()] });
  for (const t of earlier) {
    const slot = t.number - 1;
    const [rows, batches, enrolled] = await Promise.all([
      scope.findMany(scoreEntry, and(eq(scoreEntry.termId, t.id), inArray(scoreEntry.studentId, studentIds))!),
      scope.findMany(resultBatch, and(eq(resultBatch.termId, t.id), eq(resultBatch.status, "released"))!),
      scope.findMany(enrollment, and(eq(enrollment.termId, t.id), inArray(enrollment.studentId, studentIds))!),
    ]);
    const releasedArms = new Set(batches.map((b) => b.classArmId));
    const okStudent = (id: string) => {
      const e = enrolled.find((x) => x.studentId === id);
      return !!e && releasedArms.has(e.classArmId);
    };
    for (const r of rows) {
      if (!okStudent(r.studentId)) continue;
      const m = out.get(r.studentId)!.byTerm[slot];
      m.set(r.subjectId, round((m.get(r.subjectId) ?? 0) + r.value, 2));
    }
  }
  return out;
}

/** A student's term report card. Nothing is returned before the class arm's results are released (unless staff preview). */
export async function getReportCard(scope: TenantScope, studentId: string, termId: string, opts: { allowUnreleased?: boolean } = {}): Promise<ReportCardResult> {
  const { label } = await getTermLabel(scope, termId);
  const armId = await classArmForTerm(scope, studentId, termId);
  if (!armId) return { status: "not_released", termLabel: label };
  const built = await buildReportCards(scope, termId, armId, { studentIds: [studentId], allowUnreleased: opts.allowUnreleased });
  if (!built.released && !opts.allowUnreleased) return { status: "not_released", termLabel: label };
  const card = built.cards[0];
  return card ? { status: "released", card } : { status: "no_results", termLabel: label };
}

/** Terms whose report card this student can see (released for the class they were in), newest first. */
export async function releasedTermsFor(scope: TenantScope, studentId: string): Promise<{ termId: string; label: string; releasedAt: Date | null }[]> {
  const [me, enrolled, batches] = await Promise.all([
    scope.findFirst(student, eq(student.id, studentId)),
    scope.findMany(enrollment, eq(enrollment.studentId, studentId)),
    scope.findMany(resultBatch, eq(resultBatch.status, "released")),
  ]);
  const armFor = (termId: string) => enrolled.find((e) => e.termId === termId)?.classArmId ?? me?.classArmId ?? null;
  const mine = batches.filter((b) => armFor(b.termId) === b.classArmId);
  const out = [];
  for (const b of mine) {
    const t = await termInfo(scope, b.termId);
    if (t) out.push({ termId: b.termId, label: t.label, releasedAt: b.releasedAt, sort: `${t.sessionName}-${t.number}` });
  }
  return out.sort((a, b) => b.sort.localeCompare(a.sort)).map((r) => ({ termId: r.termId, label: r.label, releasedAt: r.releasedAt }));
}
