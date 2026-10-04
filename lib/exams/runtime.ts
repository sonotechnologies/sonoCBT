/**
 * Exam runtime on the server: start/resume, the page payload, sync and submit.
 * The server owns the deadline and does all marking; correct answers never
 * leave this module.
 */
import { featureBlock } from "@/lib/billing/gate";
import { and, eq, inArray, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import {
  attempt,
  attemptAnswer,
  classArm,
  exam,
  examCandidate,
  examPin,
  examQuestion,
  examSection,
  integrityEvent,
  type AttemptResponse,
  type IntegritySettings,
  type ExamQuestionSnapshot,
  type LateAnswer,
} from "@/lib/db/schema";
import { renderDoc } from "@/lib/questions/render";
import type { School, Student } from "@/lib/tenant/context";
import type { TenantScope } from "@/lib/tenant/scope";
import { DEVICE_EVENTS, FLAG_EVENTS, ipAllowed, TAKEOVER_AFTER_MS, type EventType } from "./integrity";
import { PRESETS } from "./presets";
import { examPinMatches } from "./pin";
import { attemptDeadline, buildOrder, canStart, isAnswered, isOverdue, markResponse, SYNC_GRACE_MS, validResponse } from "./rules";
import type { DeviceEvent, RuntimePayload, RuntimeQuestion, SubmitSummary, SyncAnswer, SyncRequest, SyncResponse } from "./runtime-types";

export class RuntimeError extends Error {}

type AttemptRow = typeof attempt.$inferSelect;
type ExamRow = typeof exam.$inferSelect;

const MAX_ANSWERS_PER_SYNC = 300;

// ─── Start / resume ──────────────────────────────────────────────────────────

async function candidateExam(scope: TenantScope, studentId: string, examId: string) {
  const [e, seat] = await Promise.all([
    scope.findFirst(exam, eq(exam.id, examId)),
    scope.findFirst(examCandidate, and(eq(examCandidate.examId, examId), eq(examCandidate.studentId, studentId))),
  ]);
  if (!e || e.status === "draft" || !seat) throw new RuntimeError("This exam isn't on your list. Speak to your invigilator.");
  return e;
}

export function getAttempt(scope: TenantScope, studentId: string, examId: string) {
  return scope.findFirst(attempt, and(eq(attempt.examId, examId), eq(attempt.studentId, studentId)));
}

/** Records something on the attempt's timeline. Device events carry the device's number, so a retry can't add one twice. */
export async function recordEvent(
  scope: TenantScope,
  attemptId: string,
  type: EventType,
  meta: Record<string, unknown> | null = null,
  at = new Date(),
) {
  await scope.insert(integrityEvent, { attemptId, type, meta, at });
}

function settingsOf(e: ExamRow): IntegritySettings {
  return e.integritySettings ?? PRESETS[e.integrity];
}

const NETWORK_MESSAGE = "This exam can only be taken on the school's network. Ask your invigilator.";
const DEVICE_MESSAGE = "This exam is already open on another computer. Ask your invigilator to reset your session.";

/**
 * One device per student (when the exam asks for it). The first device keeps
 * the exam; a second is turned away and the attempt is flagged. If the first
 * device has gone quiet for two minutes (flat battery, crash), the new one may
 * take over. The invigilator can also release it ("Reset session").
 */
async function claimDevice(scope: TenantScope, a: AttemptRow, e: ExamRow, device: string | undefined, now: Date): Promise<"ok" | "blocked"> {
  if (!device) return "ok";
  if (!a.deviceSessionId || a.deviceSessionId === device) {
    if (!a.deviceSessionId) await scope.update(attempt, { deviceSessionId: device }, eq(attempt.id, a.id));
    return "ok";
  }
  if (!settingsOf(e).oneDevice) {
    await scope.update(attempt, { deviceSessionId: device }, eq(attempt.id, a.id));
    return "ok";
  }
  const quiet = !a.lastSeenAt || now.getTime() - a.lastSeenAt.getTime() > TAKEOVER_AFTER_MS;
  if (quiet) {
    await scope.update(attempt, { deviceSessionId: device }, eq(attempt.id, a.id));
    await recordEvent(scope, a.id, "device_moved", null, now);
    return "ok";
  }
  // Log a blocked second sign-in once per device every five minutes, not on every retry.
  const recent = await scope.findFirst(
    integrityEvent,
    and(eq(integrityEvent.attemptId, a.id), eq(integrityEvent.type, "multi_session"), sql`${integrityEvent.meta}->>'device' = ${device}`, sql`${integrityEvent.at} > ${new Date(now.getTime() - 5 * 60_000)}`),
  );
  if (!recent) {
    await recordEvent(scope, a.id, "multi_session", { device }, now);
    await scope.update(attempt, { integrityFlags: sql`${attempt.integrityFlags} + 1` as unknown as number }, eq(attempt.id, a.id));
  }
  return "blocked";
}

/**
 * Starts the exam, or returns the attempt already under way. A PIN, when the
 * exam needs one, is checked the first time only.
 */
export async function startAttempt(
  scope: TenantScope,
  studentId: string,
  examId: string,
  opts: { pin?: string; deviceSessionId?: string; ip?: string | null; now?: Date } = {},
): Promise<AttemptRow> {
  const now = opts.now ?? new Date();
  const e = await candidateExam(scope, studentId, examId);
  const existing = await getAttempt(scope, studentId, examId);
  if (!ipAllowed(opts.ip ?? null, settingsOf(e).allowedIps)) {
    if (existing) await recordEvent(scope, existing.id, "blocked_ip", { ip: opts.ip }, now);
    throw new RuntimeError(NETWORK_MESSAGE);
  }
  if (existing) {
    const done = await finishIfOverdue(scope, existing, now);
    if (done) return done;
    if (existing.status === "in_progress" && (await claimDevice(scope, existing, e, opts.deviceSessionId, now)) === "blocked") throw new RuntimeError(DEVICE_MESSAGE);
    return existing;
  }

  const entry = canStart(e, now);
  if (!entry.ok) throw new RuntimeError(entry.message);
  if (e.pinRequired) {
    const pin = await scope.findFirst(examPin, and(eq(examPin.examId, examId), eq(examPin.studentId, studentId)));
    if (!pin || !opts.pin || !examPinMatches(pin.pinHash, examId, studentId, opts.pin)) {
      throw new RuntimeError("That PIN doesn't match your exam slip. Check it and try again.");
    }
  }

  const rows = await scope.query((db, owns) =>
    db
      .select({ id: examQuestion.id, sortOrder: examQuestion.sortOrder, snapshot: examQuestion.snapshot, sectionOrder: examSection.sortOrder })
      .from(examQuestion)
      .innerJoin(examSection, owns(examSection, eq(examSection.id, examQuestion.sectionId)))
      .where(owns(examQuestion, eq(examQuestion.examId, examId))),
  );
  if (!rows.length) throw new RuntimeError("This exam has no questions yet. Speak to your invigilator.");
  const order = buildOrder(
    rows.map((r) => ({
      id: r.id,
      sectionOrder: r.sectionOrder,
      sortOrder: r.sortOrder,
      passageId: r.snapshot.passage?.id ?? null,
      type: r.snapshot.type,
      optionIds: r.snapshot.type === "true_false" ? [] : r.snapshot.options.map((o) => o.id),
    })),
    { shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions },
    `${examId}:${studentId}`,
  );

  try {
    return await scope.transaction(async (tx) => {
      const [row] = await tx.insert(attempt, {
        examId,
        studentId,
        startedAt: now,
        deadlineAt: attemptDeadline(e, now),
        questionOrder: order.questionOrder,
        optionOrder: order.optionOrder,
        deviceSessionId: opts.deviceSessionId ?? null,
        lastSeenAt: now,
      });
      if (e.pinRequired) await tx.update(examPin, { usedAt: now }, and(eq(examPin.examId, examId), eq(examPin.studentId, studentId))!);
      await recordEvent(tx, row.id, "started", { questions: rows.length, pin: e.pinRequired }, now);
      return row;
    });
  } catch (err) {
    // Two tabs pressed Start at once: the other one won; use its attempt.
    const again = await getAttempt(scope, studentId, examId);
    if (again) return again;
    throw err;
  }
}

// ─── Payload ─────────────────────────────────────────────────────────────────

type QuestionRow = { id: string; sectionId: string; marks: number; snapshot: ExamQuestionSnapshot };

/** Questions and passages as the student sees them: HTML, in their order, never with answers. */
export function renderQuestions(rows: QuestionRow[], sections: { id: string }[], order: string[], optionOrder: Record<string, string[]>) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const secIndex = new Map(sections.map((s, i) => [s.id, i]));
  const questions: RuntimeQuestion[] = order
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => {
      const s = r.snapshot;
      const options =
        s.type === "true_false"
          ? [
              { id: "true", html: "True" },
              { id: "false", html: "False" },
            ]
          : (optionOrder[r.id] ?? s.options.map((o) => o.id))
              .map((oid) => s.options.find((o) => o.id === oid))
              .filter((o): o is NonNullable<typeof o> => !!o)
              .map((o) => ({ id: o.id, html: renderDoc(o.content) }));
      return { id: r.id, sectionIndex: secIndex.get(r.sectionId) ?? 0, type: s.type, marks: r.marks, stemHtml: renderDoc(s.stem), options, passageId: s.passage?.id ?? null };
    });
  const passages: RuntimePayload["passages"] = {};
  for (const r of rows) {
    const p = r.snapshot.passage;
    if (!p || passages[p.id] || !questions.some((q) => q.passageId === p.id)) continue;
    const nums = questions.map((q, i) => (q.passageId === p.id ? i + 1 : 0)).filter(Boolean);
    const label = nums.length > 1 ? `Questions ${nums[0]}–${nums[nums.length - 1]}` : `Question ${nums[0]}`;
    passages[p.id] = { id: p.id, title: p.title, html: renderDoc(p.content), label };
  }
  return { questions, passages };
}

/** Everything the runtime page needs, rendered to HTML, in this student's order, without answers. */
export async function buildPayload(
  scope: TenantScope,
  a: AttemptRow,
  ctx: { school: School; student: Student; schoolSlug: string; className: string | null },
  now = new Date(),
): Promise<RuntimePayload> {
  const [e, rows, sections, answers] = await Promise.all([
    scope.findFirst(exam, eq(exam.id, a.examId)),
    scope.findMany(examQuestion, eq(examQuestion.examId, a.examId)),
    scope.findMany(examSection, eq(examSection.examId, a.examId)),
    scope.findMany(attemptAnswer, eq(attemptAnswer.attemptId, a.id)),
  ]);
  const secs = sections.sort((x, y) => x.sortOrder - y.sortOrder);
  const { questions, passages } = renderQuestions(rows, secs, a.questionOrder, a.optionOrder);

  return {
    attemptId: a.id,
    syncUrl: `/s/${ctx.schoolSlug}/exam/${a.examId}/sync`,
    homeUrl: `/s/${ctx.schoolSlug}/student`,
    loginUrl: `/s/${ctx.schoolSlug}/login`,
    school: { name: ctx.school.name, logoUrl: ctx.school.logoUrl },
    exam: {
      title: e!.title,
      series: e!.series,
      fullTitle: e!.fullTitle,
      calculator: e!.calculator,
      integrity: e!.integritySettings ?? PRESETS[e!.integrity],
    },
    student: {
      name: `${ctx.student.firstName} ${ctx.student.lastName}`,
      firstName: ctx.student.firstName,
      admissionNo: ctx.student.admissionNo,
      className: ctx.className,
      photoUrl: ctx.student.photoUrl,
    },
    sections: secs.map((s) => ({ title: s.title })),
    questions,
    passages,
    answers: Object.fromEntries(answers.map((x) => [x.examQuestionId, { response: x.response, flagged: x.flagged, seq: x.clientSeq }])),
    currentIndex: Math.min(a.currentIndex, Math.max(0, questions.length - 1)),
    clientSeq: a.clientSeq,
    eventSeq: a.eventSeq,
    deadlineAt: a.deadlineAt.getTime(),
    serverNow: now.getTime(),
  };
}

export async function classNameOf(scope: TenantScope, classArmId: string | null) {
  if (!classArmId) return null;
  return (await scope.findFirst(classArm, eq(classArm.id, classArmId)))?.name ?? null;
}

// ─── Finishing ───────────────────────────────────────────────────────────────

async function summaryOf(scope: TenantScope, a: AttemptRow): Promise<SubmitSummary> {
  const [e, answers] = await Promise.all([scope.findFirst(exam, eq(exam.id, a.examId)), scope.findMany(attemptAnswer, eq(attemptAnswer.attemptId, a.id))]);
  const pending = answers.some((x) => isAnswered(x.response) && x.marksAwarded === null);
  return {
    submittedAt: (a.submittedAt ?? new Date()).getTime(),
    answered: answers.filter((x) => isAnswered(x.response)).length,
    total: a.questionOrder.length,
    score: e?.showScoreAfterSubmit && !pending && a.score !== null && a.maxScore !== null ? { score: a.score, max: a.maxScore } : null,
    auto: a.status === "auto_submitted",
    reason: a.submitReason,
  };
}

/** Marks every answer of an attempt (objective types; theory waits for a teacher). */
async function markAll(tx: TenantScope, a: AttemptRow) {
  const [questions, answers] = await Promise.all([tx.findMany(examQuestion, eq(examQuestion.examId, a.examId)), tx.findMany(attemptAnswer, eq(attemptAnswer.attemptId, a.id))]);
  const inPaper = new Set(a.questionOrder);
  const qs = questions.filter((q) => inPaper.has(q.id));
  const marked = answers
    .map((ans) => {
      const q = qs.find((x) => x.id === ans.examQuestionId);
      return q ? { id: ans.id, ...markResponse(q.snapshot, q.marks, ans.response) } : null;
    })
    .filter((m): m is NonNullable<typeof m> => !!m);
  if (marked.length) {
    const values = sql.join(
      marked.map((m) => sql`(${m.id}::uuid, ${m.isCorrect}::boolean, ${m.marksAwarded}::numeric)`),
      sql`, `,
    );
    await tx.query((db) =>
      db.execute(sql`
        update ${attemptAnswer} as a
        set is_correct = v.is_correct, marks_awarded = v.marks, updated_at = now()
        from (values ${values}) as v(id, is_correct, marks)
        where a.id = v.id and a.school_id = ${tx.schoolId}
      `),
    );
  }
  return {
    score: Math.round(marked.reduce((s, m) => s + (m.marksAwarded ?? 0), 0) * 100) / 100,
    maxScore: qs.reduce((s, q) => s + q.marks, 0),
    answered: answers.filter((x) => isAnswered(x.response)).length,
  };
}

export type SubmitReason = "student" | "timeout" | "integrity" | "staff";

/**
 * Marks every answer and closes the attempt. Safe to call twice: only the
 * first call (while still in progress) does anything.
 */
export async function finalizeAttempt(
  scope: TenantScope,
  a: AttemptRow,
  how: "submitted" | "auto_submitted",
  now = new Date(),
  reason: SubmitReason = how === "submitted" ? "student" : "timeout",
  meta: Record<string, unknown> = {},
): Promise<AttemptRow> {
  return scope.transaction(async (tx) => {
    const { score, maxScore, answered } = await markAll(tx, a);
    const submittedAt = reason === "timeout" ? new Date(Math.min(now.getTime(), a.deadlineAt.getTime())) : now;
    const [row] = await tx.update(
      attempt,
      { status: how, submittedAt, submitReason: reason, score, maxScore, answeredCount: answered },
      and(eq(attempt.id, a.id), eq(attempt.status, "in_progress"))!,
    );
    if (row) {
      const type: EventType = reason === "staff" ? "force_submitted" : how === "auto_submitted" ? "auto_submitted" : "submitted";
      await recordEvent(tx, a.id, type, { reason, answered, total: a.questionOrder.length, ...meta }, submittedAt);
      if (how === "auto_submitted" && reason !== "staff") {
        await tx.query((db) =>
          audit(db, { schoolId: tx.schoolId, actorUserId: null, action: "attempt.auto_submit", entityType: "attempt", entityId: a.id, meta: { reason, ...meta } }),
        );
      }
    }
    return row ?? (await tx.findFirst(attempt, eq(attempt.id, a.id)))!;
  });
}

/** Re-marks a finished attempt (after late answers are accepted, for example). */
export async function remarkAttempt(scope: TenantScope, a: AttemptRow): Promise<AttemptRow> {
  return scope.transaction(async (tx) => {
    const { score, maxScore, answered } = await markAll(tx, a);
    const [row] = await tx.update(attempt, { score, maxScore, answeredCount: answered }, eq(attempt.id, a.id));
    return row;
  });
}

/** The server's own auto-submit: once the deadline (plus grace) has passed. */
export async function finishIfOverdue(scope: TenantScope, a: AttemptRow, now = new Date()): Promise<AttemptRow | null> {
  if (a.status !== "in_progress" || !isOverdue(a.deadlineAt, now)) return null;
  return finalizeAttempt(scope, a, "auto_submitted", now, "timeout");
}

// ─── Sync ────────────────────────────────────────────────────────────────────

function clean(answers: SyncAnswer[]): SyncAnswer[] {
  // Keep only the newest write per question.
  const latest = new Map<string, SyncAnswer>();
  for (const x of answers) {
    if (!Number.isInteger(x.seq) || x.seq < 1) continue;
    const prev = latest.get(x.id);
    if (!prev || prev.seq < x.seq) latest.set(x.id, x);
  }
  return [...latest.values()];
}

/** Stores new device events; returns how many were leaves and how many raise the flag. */
async function storeEvents(scope: TenantScope, a: AttemptRow, settings: IntegritySettings, events: DeviceEvent[], now: Date) {
  const fresh = events
    .filter((ev) => Number.isInteger(ev.seq) && ev.seq > a.eventSeq && DEVICE_EVENTS.has(ev.type as EventType))
    .filter((ev) => settings.logTabSwitches || (ev.type !== "tab_hidden" && ev.type !== "fullscreen_exit"))
    .slice(0, 50);
  const maxSeq = events.reduce((m, ev) => (Number.isInteger(ev.seq) ? Math.max(m, ev.seq) : m), a.eventSeq);
  if (!fresh.length) return { leaves: 0, flags: 0, maxSeq };
  // The device's clock is only roughly right; never record an event in the future or before the start.
  const at = (ms: number) => new Date(Math.min(now.getTime(), Math.max(a.startedAt.getTime(), Number(ms) || now.getTime())));
  const inserted = await scope.query((db) =>
    db
      .insert(integrityEvent)
      .values(
        fresh.map((ev) => ({
          schoolId: scope.schoolId,
          attemptId: a.id,
          type: ev.type,
          clientSeq: ev.seq,
          at: at(ev.at),
          meta: ev.awayMs ? { awayMs: Math.min(Math.max(0, Math.round(ev.awayMs)), 24 * 3600_000) } : null,
        })),
      )
      .onConflictDoNothing()
      .returning({ type: integrityEvent.type }),
  );
  return {
    leaves: inserted.filter((r) => r.type === "tab_hidden").length,
    flags: inserted.filter((r) => FLAG_EVENTS.has(r.type)).length,
    maxSeq,
  };
}

/**
 * Applies answers and events from the device. Each answer carries the device's
 * sequence number; the server keeps whichever write for a question is newest,
 * so retries and out-of-order requests are harmless. Also the heartbeat, and
 * where the integrity rules are applied.
 */
export async function syncAttempt(scope: TenantScope, studentId: string, req: SyncRequest, now = new Date(), ip: string | null = null): Promise<SyncResponse> {
  if (!Array.isArray(req.answers) || req.answers.length > MAX_ANSWERS_PER_SYNC) return { ok: false, error: "Too many answers in one request." };
  let a = await scope.findFirst(attempt, and(eq(attempt.id, req.attemptId), eq(attempt.studentId, studentId)));
  if (!a) return { ok: false, error: "Exam not found." };
  const e = (await scope.findFirst(exam, eq(exam.id, a.examId)))!;
  const settings = settingsOf(e);

  const answers = clean(req.answers);
  const ackSeq = answers.reduce((m, x) => Math.max(m, x.seq), 0);
  const events = Array.isArray(req.events) ? req.events : [];
  a = (await finishIfOverdue(scope, a, now)) ?? a;

  if (a.status !== "in_progress") {
    // Too late to count. Keep anything new for the exam officer to see, but don't mark it.
    const fresh = answers.filter((x) => x.seq > a!.clientSeq);
    let lateCount = a.lateAnswers?.length ?? 0;
    if (fresh.length) {
      const merged = new Map<string, LateAnswer>((a.lateAnswers ?? []).map((l) => [l.examQuestionId, l]));
      for (const x of fresh) {
        const prev = merged.get(x.id);
        if (!prev || prev.clientSeq < x.seq) merged.set(x.id, { examQuestionId: x.id, response: x.response, clientSeq: x.seq, receivedAt: now.toISOString() });
      }
      const late = [...merged.values()];
      await scope.update(attempt, { lateAnswers: late }, eq(attempt.id, a.id));
      lateCount = late.length;
    }
    const eventAck = events.reduce((m, ev) => Math.max(m, ev.seq || 0), 0);
    return { ok: true, status: "submitted", serverNow: now.getTime(), summary: await summaryOf(scope, a), ackSeq, eventAck, lateCount };
  }

  if (!ipAllowed(ip, settings.allowedIps)) {
    await recordEvent(scope, a.id, "blocked_ip", { ip }, now);
    return { ok: false, error: NETWORK_MESSAGE, blocked: "network" };
  }
  if ((await claimDevice(scope, a, e, typeof req.deviceSessionId === "string" ? req.deviceSessionId.slice(0, 64) : undefined, now)) === "blocked") {
    return { ok: false, error: DEVICE_MESSAGE, blocked: "device" };
  }

  const inPaper = new Set(a.questionOrder);
  const ids = answers.map((x) => x.id).filter((id) => inPaper.has(id));
  if (ids.length) {
    const qs = await scope.findMany(examQuestion, and(eq(examQuestion.examId, a.examId), inArray(examQuestion.id, ids)));
    const snap = new Map(qs.map((q) => [q.id, q.snapshot as ExamQuestionSnapshot]));
    const rows = answers
      .filter((x) => snap.has(x.id) && validResponse(snap.get(x.id)!, x.response as AttemptResponse | null))
      .map((x) => ({
        schoolId: scope.schoolId,
        attemptId: a!.id,
        examQuestionId: x.id,
        response: x.response,
        flagged: !!x.flagged,
        clientSeq: x.seq,
        answeredAt: now,
      }));
    if (rows.length) {
      await scope.query((db) =>
        db
          .insert(attemptAnswer)
          .values(rows)
          .onConflictDoUpdate({
            target: [attemptAnswer.attemptId, attemptAnswer.examQuestionId],
            set: {
              response: sql`excluded.response`,
              flagged: sql`excluded.flagged`,
              clientSeq: sql`excluded.client_seq`,
              answeredAt: sql`excluded.answered_at`,
              updatedAt: now,
            },
            setWhere: sql`${attemptAnswer.clientSeq} < excluded.client_seq`,
          }),
      );
    }
  }

  const ev = await storeEvents(scope, a, settings, events, now);
  const answered = answers.length
    ? (await scope.findMany(attemptAnswer, eq(attemptAnswer.attemptId, a.id))).filter((x) => isAnswered(x.response)).length
    : a.answeredCount;
  const index = Number.isInteger(req.currentIndex) ? Math.max(0, Math.min(req.currentIndex, a.questionOrder.length - 1)) : a.currentIndex;
  const [updated] = await scope.update(
    attempt,
    {
      currentIndex: index,
      lastSeenAt: now,
      clientSeq: Math.max(a.clientSeq, ackSeq),
      answeredCount: answered,
      eventSeq: ev.maxSeq,
      leaveCount: a.leaveCount + ev.leaves,
      integrityFlags: a.integrityFlags + ev.flags,
    },
    and(eq(attempt.id, a.id), eq(attempt.status, "in_progress"))!,
  );
  a = updated ?? a;

  // Strict exams: too many tab switches ends the exam.
  const limit = settings.submitAfterLeaves;
  if (limit !== null && a.leaveCount >= limit) {
    const done = await finalizeAttempt(scope, a, "auto_submitted", now, "integrity", { leaves: a.leaveCount });
    return { ok: true, status: "submitted", serverNow: now.getTime(), summary: await summaryOf(scope, done), ackSeq, eventAck: ev.maxSeq, lateCount: 0 };
  }
  if (req.submit) {
    const done = await finalizeAttempt(scope, a, "submitted", now, "student");
    return { ok: true, status: "submitted", serverNow: now.getTime(), summary: await summaryOf(scope, done), ackSeq, eventAck: ev.maxSeq, lateCount: 0 };
  }
  return { ok: true, status: "in_progress", serverNow: now.getTime(), deadlineAt: a.deadlineAt.getTime(), ackSeq, eventAck: ev.maxSeq, leaves: a.leaveCount };
}

export async function attemptSummary(scope: TenantScope, a: AttemptRow): Promise<SubmitSummary> {
  return summaryOf(scope, a);
}

/** Grace for in-flight answers, exported for the page's copy. */
export const GRACE_SECONDS = SYNC_GRACE_MS / 1000;
export type { ExamRow };

/**
 * An identity photo from the exam (Strict, with the student's consent). At most
 * one every two minutes; stored privately; the monitor shows it to staff.
 */
export async function saveSnapshot(scope: TenantScope, studentId: string, attemptId: string, jpeg: Uint8Array, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  const a = await scope.findFirst(attempt, and(eq(attempt.id, attemptId), eq(attempt.studentId, studentId)));
  if (!a || a.status !== "in_progress") return { ok: false, error: "Exam not found." };
  const e = (await scope.findFirst(exam, eq(exam.id, a.examId)))!;
  if (!settingsOf(e).snapshot) return { ok: false, error: "This exam doesn't take photos." };
  if (await featureBlock(scope, "snapshots")) return { ok: false, error: "This school's plan doesn't include identity photos." };
  if (jpeg.byteLength > 200_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return { ok: false, error: "That isn't a small JPEG photo." };
  const recent = await scope.findFirst(integrityEvent, and(eq(integrityEvent.attemptId, a.id), eq(integrityEvent.type, "snapshot"), sql`${integrityEvent.at} > ${new Date(now.getTime() - 110_000)}`));
  if (recent) return { ok: true };
  const { storePrivate } = await import("@/lib/storage");
  const key = await storePrivate(scope.schoolId, jpeg);
  await recordEvent(scope, a.id, "snapshot", { key }, now);
  return { ok: true };
}
