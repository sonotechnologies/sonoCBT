import "server-only";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { can, type Actor } from "@/lib/auth/permissions";
import { billingState } from "@/lib/billing/state";
import { planByCode } from "@/lib/billing/plans";
import { attempt, classArm, exam, examAssignment, examCandidate, examSubject, student, subject, subjectOffering, term } from "@/lib/db/schema";
import { formatDate, formatTime, TIME_ZONE } from "@/lib/format";
import { markingQueue } from "@/lib/marking/service";
import { releaseOverview } from "@/lib/results/pipeline";
import type { TenantScope } from "@/lib/tenant/scope";

const DAY = 86_400_000;

export type ExamRow = {
  id: string;
  time: string;
  day: string;
  title: string;
  detail: string;
  count: string;
  status: "live" | "scheduled" | "marking" | "done" | "draft";
  href: string;
};
export type Alert = { tone: "warn" | "info" | "quiet"; title: string; detail: string; cta: string; href: string };
export type LevelRow = { level: string; released: number; approved: number; review: number; draft: number; label: string };

/** Lagos calendar date (YYYY-MM-DD) and hour for a moment. */
function lagos(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "long" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday as string };
}
/** Midnight in Lagos (UTC+1, no daylight saving) for a date key. */
const lagosMidnight = (key: string) => new Date(`${key}T00:00:00+01:00`);

/** "Mrs. Folake Adeyemi" → "Mrs. Adeyemi"; names without a title stay as the first name. */
export function greetingName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const titled = /^(mr|mrs|ms|miss|dr|prof|chief|alhaji|alhaja|pastor|rev)\.?$/i.test(parts[0] ?? "");
  return titled && parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : (parts[0] ?? name);
}

export function greeting(hour: number) {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** "Today", "Tomorrow" or "Mon 28/09". */
function dayLabel(d: Date, now: Date) {
  const k = lagos(d).key;
  if (k === lagos(now).key) return "Today";
  if (k === lagos(new Date(now.getTime() + DAY)).key) return "Tomorrow";
  if (k === lagos(new Date(now.getTime() - DAY)).key) return "Yesterday";
  return `${lagos(d).weekday.slice(0, 3)} ${formatDate(d).slice(0, 5)}`;
}

/**
 * Everything on the staff dashboard, shaped by what this person may do: the
 * admin sees the whole school; an exam officer exams and results; a teacher
 * their own exams, marking and classes.
 */
export async function staffDashboard(scope: TenantScope, actor: Actor, now = new Date()) {
  const s = { schoolId: scope.schoolId };
  const may = {
    manageExams: can(actor, "exam.manage", s),
    monitor: can(actor, "exam.monitor", s),
    review: can(actor, "results.review", s),
    release: can(actor, "results.release", s),
    billing: can(actor, "billing.manage", s),
    importQs: can(actor, "question.create", s),
  };
  const schoolWide = may.manageExams || may.review || may.release;
  const L = lagos(now);

  // ── The term and its week ──
  const [cur] = await scope.findMany(term, eq(term.isCurrent, true));
  let week: string | null = null;
  if (cur?.startsOn) {
    const start = lagosMidnight(cur.startsOn);
    const n = Math.floor((now.getTime() - start.getTime()) / (7 * DAY)) + 1;
    const total = cur.endsOn ? Math.ceil((lagosMidnight(cur.endsOn).getTime() - start.getTime() + DAY) / (7 * DAY)) : null;
    if (n >= 1) week = total ? `week ${Math.min(n, total)} of ${total}` : `week ${n}`;
  }

  // ── Which exams and subjects this person sees ──
  const offerings = await scope.findMany(subjectOffering, eq(subjectOffering.teacherId, actor.id));
  const mySubjects = new Set(offerings.map((o) => o.subjectId));
  const myArms = new Set(offerings.map((o) => o.classArmId));
  const from = new Date(lagosMidnight(L.key).getTime() - 7 * DAY);
  const to = new Date(lagosMidnight(L.key).getTime() + 8 * DAY);
  const examsNear = await scope.findMany(exam, and(gte(exam.windowEnd, from), lte(exam.windowStart, to))!);
  const ids = examsNear.map((e) => e.id);
  const [subjects, armsAll, subs, assigns, candidates, attempts] = await Promise.all([
    scope.findMany(subject),
    scope.findMany(classArm),
    ids.length ? scope.findMany(examSubject, inArray(examSubject.examId, ids)) : [],
    ids.length ? scope.findMany(examAssignment, inArray(examAssignment.examId, ids)) : [],
    ids.length ? scope.query((db, owns) => db.select({ examId: examCandidate.examId, n: sql<number>`count(*)::int` }).from(examCandidate).where(owns(examCandidate, inArray(examCandidate.examId, ids))).groupBy(examCandidate.examId)) : [],
    ids.length ? scope.findMany(attempt, inArray(attempt.examId, ids)) : [],
  ]);
  const visible = examsNear.filter((e) => schoolWide || subs.some((x) => x.examId === e.id && mySubjects.has(x.subjectId)));
  const queue = await markingQueue(scope, actor);
  const unmarkedByExam = new Map<string, number>();
  for (const q of queue) unmarkedByExam.set(q.examId, (unmarkedByExam.get(q.examId) ?? 0) + q.total - q.marked);
  const subjectName = new Map(subjects.map((x) => [x.id, x.shortName ?? x.name]));
  const armName = new Map(armsAll.map((a) => [a.id, a.name]));

  const rows: (ExamRow & { at: number })[] = [];
  for (const e of visible) {
    const open = e.status !== "draft" && e.windowStart <= now && e.windowEnd > now;
    const closed = e.status !== "draft" && e.windowEnd <= now;
    const unmarked = unmarkedByExam.get(e.id) ?? 0;
    const mine = attempts.filter((a) => a.examId === e.id);
    const total = candidates.find((c) => c.examId === e.id)?.n ?? 0;
    const started = mine.length;
    const handedIn = mine.filter((a) => a.status !== "in_progress").length;
    const status: ExamRow["status"] = e.status === "draft" ? "draft" : open ? "live" : closed ? (unmarked ? "marking" : "done") : "scheduled";
    rows.push({
      id: e.id,
      at: e.windowStart.getTime(),
      time: formatTime(e.windowStart),
      day: dayLabel(e.windowStart, now),
      title: e.title,
      detail: [assigns.filter((a) => a.examId === e.id).map((a) => armName.get(a.classArmId) ?? "").filter(Boolean).join(", "), subs.filter((x) => x.examId === e.id).map((x) => subjectName.get(x.subjectId) ?? "").join(", ")].filter(Boolean).join(" · "),
      count: status === "live" ? `${started} / ${total}` : status === "draft" ? "not published" : `${handedIn} / ${total}`,
      status,
      href: status === "live" && may.monitor ? `exams/${e.id}/monitor` : status === "marking" ? "marking" : may.manageExams ? `exams/${e.id}` : "monitor",
    });
  }
  // Live first, then what's coming (soonest first), then this past week (latest first).
  const rank = (r: ExamRow) => (r.status === "live" ? 0 : r.status === "scheduled" || r.status === "draft" ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.at - a.at : a.at - b.at));
  const examRows: ExamRow[] = rows.slice(0, 6).map((r) => ({ id: r.id, time: r.time, day: r.day, title: r.title, detail: r.detail, count: r.count, status: r.status, href: r.href }));

  // ── Numbers ──
  const live = rows.filter((r) => r.status === "live");
  const liveIds = new Set(live.map((r) => r.id));
  const sitting = attempts.filter((a) => liveIds.has(a.examId) && a.status === "in_progress").length;
  const toMark = queue.reduce((a, q) => a + q.total - q.marked, 0);
  const topMark = [...unmarkedByExam].sort((a, b) => b[1] - a[1])[0];
  const [{ students, arms }] = await scope.query((db, owns) =>
    db
      .select({ students: sql<number>`count(*)::int`, arms: sql<number>`count(distinct ${student.classArmId})::int` })
      .from(student)
      .where(owns(student, sql`${student.classArmId} is not null`)),
  );
  const overview = cur && (schoolWide || may.billing) ? await releaseOverview(scope, cur.id) : null;
  const released = overview?.rows.filter((r) => r.status === "released").length ?? 0;

  const stats: { k: string; v: string; d: string }[] = [
    schoolWide ? { k: "Students", v: students.toLocaleString("en-NG"), d: `across ${arms} class arms` } : { k: "Your classes", v: String(myArms.size), d: `${mySubjects.size} ${mySubjects.size === 1 ? "subject" : "subjects"}` },
    { k: "Sitting now", v: String(sitting), d: live.length ? live.map((r) => r.title).join(", ") : "No exam running" },
    { k: "Theory to mark", v: String(toMark), d: topMark ? (examsNear.find((e) => e.id === topMark[0])?.title ?? "") : "All marked" },
    overview ? { k: "Results released", v: `${released}/${overview.rows.length}`, d: "class arms this term" } : { k: "Exams this week", v: String(rows.filter((r) => r.status !== "done").length), d: "in your subjects" },
  ];

  // ── Things that need someone ──
  const alerts: Alert[] = [];
  if (may.monitor && liveIds.size) {
    const flagged = attempts.filter((a) => liveIds.has(a.examId) && a.integrityFlags > 0).sort((a, b) => b.integrityFlags - a.integrityFlags);
    if (flagged.length) {
      const [top] = await scope.findMany(student, eq(student.id, flagged[0].studentId));
      const ex = live.find((r) => r.id === flagged[0].examId)!;
      alerts.push({
        tone: "warn",
        title: `${flagged.length} ${flagged.length === 1 ? "student" : "students"} flagged in ${ex.title}`,
        detail: top ? `${top.firstName} ${top.lastName} has ${flagged[0].integrityFlags} integrity ${flagged[0].integrityFlags === 1 ? "event" : "events"}${flagged[0].leaveCount ? `, including leaving the exam window ${flagged[0].leaveCount} ${flagged[0].leaveCount === 1 ? "time" : "times"}` : ""}.` : "",
        cta: "View",
        href: `exams/${ex.id}/monitor`,
      });
    }
  }
  if (may.manageExams) {
    const soon = examsNear.filter((e) => e.status === "draft" && e.windowStart > now && e.windowStart.getTime() - now.getTime() < 4 * DAY).sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
    for (const e of soon.slice(0, 2)) {
      alerts.push({ tone: "warn", title: `${e.title} isn't published`, detail: `It starts ${dayLabel(e.windowStart, now).toLowerCase()} at ${formatTime(e.windowStart)}. Publish it so students are seated and slips can be printed.`, cta: "Open", href: `exams/${e.id}` });
    }
  }
  if (overview && may.review) {
    for (const r of overview.rows.filter((x) => x.status === "under_review").slice(0, 2)) {
      alerts.push({ tone: "info", title: `${r.name} sent for review`, detail: r.lastBy ? `${r.lastBy}${r.lastAt ? ` at ${formatTime(r.lastAt)} on ${formatDate(r.lastAt)}` : ""}.` : "Waiting for the exam officer.", cta: "Review", href: "results" });
    }
  }
  if (overview && may.release) {
    const ready = overview.rows.filter((x) => x.status === "approved");
    if (ready.length) alerts.push({ tone: "info", title: `${ready.length} ${ready.length === 1 ? "class is" : "classes are"} approved`, detail: `${ready.map((r) => r.name).join(", ")} can be released to parents.`, cta: "Release", href: "results" });
  }
  if (toMark && !alerts.length) alerts.push({ tone: "info", title: `${toMark} theory ${toMark === 1 ? "answer" : "answers"} to mark`, detail: "Names stay hidden while you mark.", cta: "Mark", href: "marking" });
  if (may.billing) {
    const b = await scope.query((db) => billingState(db, scope.schoolId, now));
    const plan = b.plan ? planByCode(b.plan) : null;
    if (b.status === "trial") alerts.push({ tone: "quiet", title: `Free trial ends ${formatDate(b.trialEndsAt!)}`, detail: `Every feature is on until then. ${b.activeStudents} students × ₦${planByCode("standard").naira.toLocaleString("en-NG")} on Standard after that.`, cta: "Billing", href: "billing" });
    else if (b.status === "active" && plan) alerts.push({ tone: "quiet", title: `${plan.name} paid for this term`, detail: `${b.activeStudents} students × ₦${plan.naira.toLocaleString("en-NG")}. Renews at the start of next term.`, cta: "Billing", href: "billing" });
    else if (b.status === "grace") alerts.push({ tone: "warn", title: `Payment due by ${formatDate(b.graceEndsAt!)}`, detail: "Pay for this term to keep every feature on.", cta: "Pay", href: "billing" });
    else if (b.status === "lapsed") alerts.push({ tone: "warn", title: "Subscription lapsed", detail: "Paid features and new exams are paused. Your data is safe.", cta: "Pay", href: "billing" });
  }

  // ── Results by class level ──
  const levels: LevelRow[] = [];
  if (overview && schoolWide) {
    const byLevel = new Map<string, typeof overview.rows>();
    for (const r of overview.rows) if (r.subjectsTotal) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
    for (const [level, rs] of byLevel) {
      const sum = (st: string) => rs.filter((r) => r.status === st).reduce((a, r) => a + r.subjectsTotal, 0);
      const total = rs.reduce((a, r) => a + r.subjectsTotal, 0);
      const ready = rs.reduce((a, r) => a + (r.status === "released" || r.status === "approved" ? r.subjectsTotal : r.subjectsReady), 0);
      levels.push({ level, released: sum("released"), approved: sum("approved"), review: sum("under_review"), draft: sum("draft"), label: rs.every((r) => r.status === "released") ? "All released" : `${ready} of ${total} subjects ready` });
    }
  }

  const quick = [
    may.manageExams && { t: "New exam", href: "exams/new", primary: true },
    may.importQs && { t: "Import questions", href: "import" },
    { t: "Enter CA", href: "results/classes" },
    (may.review || may.release) && { t: "Release results", href: "results" },
    !may.manageExams && toMark > 0 && { t: "Mark theory", href: "marking", primary: true },
  ].filter((x): x is { t: string; href: string; primary?: boolean } => !!x);

  return {
    dateLine: [`${L.weekday} ${formatDate(now)}`, cur ? `${["", "1st", "2nd", "3rd"][cur.number]} Term${week ? `, ${week}` : ""}` : null].filter(Boolean).join(" · "),
    hello: greeting(L.hour),
    quick,
    stats,
    exams: examRows,
    alerts,
    levels,
    termName: cur ? `${["", "1st", "2nd", "3rd"][cur.number]} Term` : "This term",
    resultsVisible: !!overview && schoolWide,
  };
}

