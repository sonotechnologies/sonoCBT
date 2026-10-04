import { and, eq, inArray } from "drizzle-orm";
import { attempt, exam, student, subject } from "@/lib/db/schema";
import { round } from "@/lib/grading";
import type { TenantScope } from "@/lib/tenant/scope";
import { AnalyticsError, PASS_MARK, type AnalyticsAccess } from "./access";
import { DONE } from "./stats";
import { mean, orderedTerms, studentAverages, subjectScores, type SubjectScore } from "./terms";
import { topicMastery } from "./topics";

/** A student is at risk below this average, or after dropping this many points since last term. */
export const AT_RISK_BELOW = PASS_MARK;
export const AT_RISK_DROP = 10;

const passRate = (rows: SubjectScore[]) => (rows.length ? Math.round((rows.filter((r) => r.pct >= PASS_MARK).length / rows.length) * 100) : null);
const delta = (now: number | null, before: number | null) => (now !== null && before !== null ? round(now - before, 1) : null);

/**
 * The whole school this term: averages against last term, classes over three
 * terms, subject ranking, subjects to watch and students at risk. Averages
 * come from the CA grid over the parts entered so far.
 */
export async function schoolOverview(scope: TenantScope, access: AnalyticsAccess, termId: string) {
  if (!access.schoolWide) throw new AnalyticsError("The school overview is for the admin and exam officer.");
  const terms = await orderedTerms(scope);
  const at = terms.findIndex((t) => t.id === termId);
  if (at < 0) throw new AnalyticsError("Term not found.");
  const recent = terms.slice(Math.max(0, at - 2), at + 1);
  const prevTerm = at > 0 ? terms[at - 1] : null;
  const scores = await subjectScores(scope, recent.map((t) => t.id));
  const now = scores.filter((s) => s.termId === termId);
  const before = prevTerm ? scores.filter((s) => s.termId === prevTerm.id) : [];
  const avgNow = studentAverages(now);
  const avgBefore = studentAverages(before);
  const schoolAvg = mean([...avgNow.values()]);
  const prevAvg = mean([...avgBefore.values()]);

  const [subjects, students, exams] = await Promise.all([scope.findMany(subject), scope.findMany(student), scope.findMany(exam, eq(exam.termId, termId))]);
  const published = exams.filter((e) => e.publishedAt);
  const scripts = published.length ? (await scope.findMany(attempt, and(inArray(attempt.examId, published.map((e) => e.id)), inArray(attempt.status, DONE))!)).length : 0;
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  // Subjects this term, against last term.
  const subjectRows = [...new Set(now.map((s) => s.subjectId))]
    .map((id) => {
      const mineNow = now.filter((s) => s.subjectId === id);
      const avg = mean(mineNow.map((s) => s.pct));
      const prev = mean(before.filter((s) => s.subjectId === id).map((s) => s.pct));
      return { id, name: subjectName.get(id) ?? "", students: mineNow.length, average: avg, passRate: passRate(mineNow), below: mineNow.filter((s) => s.pct < PASS_MARK).length, change: delta(avg, prev) };
    })
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));

  // Classes now, and levels over the recent terms.
  const arms = [...new Set(now.map((s) => s.arm))].sort().map((arm) => {
    const ids = new Set(now.filter((s) => s.arm === arm).map((s) => s.studentId));
    const xs = [...ids].map((id) => avgNow.get(id)!);
    return { arm, students: ids.size, average: mean(xs), passRate: passRate(now.filter((s) => s.arm === arm)) };
  });
  const levels = [...new Set(scores.map((s) => s.level))].sort();
  const trend = levels.map((level) => ({
    level,
    values: recent.map((t) => {
      const rows = scores.filter((s) => s.level === level && s.termId === t.id);
      return mean([...studentAverages(rows).values()]);
    }),
  }));

  // Students at risk.
  const atRisk = [...avgNow]
    .map(([id, avg]) => {
      const st = students.find((s) => s.id === id);
      const prev = avgBefore.get(id) ?? null;
      const mineNow = now.filter((s) => s.studentId === id).sort((a, b) => a.pct - b.pct);
      return {
        id,
        name: st ? `${st.firstName} ${st.lastName}` : "",
        admissionNo: st?.admissionNo ?? "",
        arm: mineNow[0]?.arm ?? "—",
        average: avg,
        previous: prev,
        change: delta(avg, prev),
        weakest: mineNow[0] ? `${subjectName.get(mineNow[0].subjectId) ?? ""} ${mineNow[0].pct}%` : "",
        reason: avg < AT_RISK_BELOW ? "below" : prev !== null && avg - prev <= -AT_RISK_DROP ? "dropping" : null,
      };
    })
    .filter((r): r is typeof r & { reason: "below" | "dropping" } => r.reason !== null)
    .sort((a, b) => a.average - b.average);

  // Subjects to watch: the biggest fall, the most students below the pass mark, the weakest exam topic, the biggest rise.
  const watch: { title: string; detail: string; value: string; tone: "bad" | "warn" | "good" }[] = [];
  const falls = subjectRows.filter((s) => s.change !== null && s.change <= -3).sort((a, b) => a.change! - b.change!);
  if (falls[0]) watch.push({ title: falls[0].name, detail: `Average fell ${Math.abs(falls[0].change!)} points from ${prevTerm?.short ?? "last term"}`, value: `−${Math.abs(falls[0].change!)}`, tone: "bad" });
  const most = [...subjectRows].filter((s) => s.below > 0).sort((a, b) => b.below / b.students - a.below / a.students)[0];
  if (most) watch.push({ title: most.name, detail: `${most.below} of ${most.students} students below ${PASS_MARK}`, value: `${Math.round((most.below / most.students) * 100)}%`, tone: "warn" });
  const topicSubjects = (await topicMastery(scope, access, { termId })).subjects;
  let weakTopic: { subject: string; topic: string; pct: number; arm: string | null } | null = null;
  for (const s of topicSubjects) {
    const m = await topicMastery(scope, access, { termId, subjectId: s.id });
    const w = m.weakest[0];
    if (w && (!weakTopic || w.pct < weakTopic.pct)) weakTopic = { subject: s.name, topic: w.name, pct: w.pct, arm: w.worstArm };
  }
  if (weakTopic) watch.push({ title: `${weakTopic.subject} · ${weakTopic.topic}`, detail: weakTopic.arm ? `Weakest topic in this term's exams (lowest in ${weakTopic.arm})` : "Weakest topic in this term's exams", value: `${Math.round(weakTopic.pct)}%`, tone: "warn" });
  const rises = subjectRows.filter((s) => s.change !== null && s.change >= 3).sort((a, b) => b.change! - a.change!);
  if (rises[0]) watch.push({ title: rises[0].name, detail: `Up ${rises[0].change} points on ${prevTerm?.short ?? "last term"}`, value: `+${rises[0].change}`, tone: "good" });

  return {
    term: terms[at],
    previous: prevTerm,
    recent,
    stats: {
      average: schoolAvg,
      change: delta(schoolAvg, prevAvg),
      passRate: passRate(now),
      exams: published.length,
      scripts,
      students: avgNow.size,
      atRisk: atRisk.length,
    },
    trend,
    arms,
    subjects: subjectRows,
    watch,
    atRisk,
  };
}
