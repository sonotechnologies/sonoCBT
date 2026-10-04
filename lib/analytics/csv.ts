import { examReport } from "./exam";
import { schoolOverview } from "./school";
import { topicMastery } from "./topics";
import type { AnalyticsAccess } from "./access";
import type { TenantScope } from "@/lib/tenant/scope";

export type Table = { name: string; columns: string[]; rows: (string | number | null)[][] };

/**
 * CSV that opens cleanly in Excel: UTF-8 BOM, CRLF, quoted where needed, and
 * cells that start like a formula (=, +, -, @) defused so a name or answer
 * can't run as one.
 */
export function toCsv(t: Table): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    let s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const TABLES = ["exam-questions", "exam-scores", "exam-topics", "topics", "subjects", "classes", "at-risk"] as const;
export type TableKey = (typeof TABLES)[number];

/** Builds one exportable table. Every table respects the same access as its screen. */
export async function buildTable(scope: TenantScope, access: AnalyticsAccess, key: TableKey, p: { exam?: string; term?: string; subject?: string }): Promise<Table> {
  if (key.startsWith("exam-")) {
    const r = await examReport(scope, access, p.exam ?? "");
    const base = r.exam.title;
    if (key === "exam-questions")
      return {
        name: `${base} questions`,
        columns: ["Q", "Code", "Subject", "Topic", "Question", "Marks", "% correct", "Correct answer", "Most-picked wrong answer", "% picked it", "% skipped", "Median seconds"],
        rows: r.questions.map((q) => [q.number, q.code, q.subject, q.topic, q.text, q.marks, q.pctCorrect, q.right.map((o) => `${o.letter} ${o.text}`).join("; "), q.wrong ? `${q.wrong.letter} ${q.wrong.text}` : "", q.wrong?.picked ?? null, q.skipped, q.medianSeconds === null ? null : Math.round(q.medianSeconds)]),
      };
    if (key === "exam-scores")
      return {
        name: `${base} scores`,
        columns: ["Name", "Admission no.", "Class", "Score", "Out of", "%", "Minutes", "Integrity flags", "Ended by"],
        rows: r.scripts.map((s) => [s.name, s.admissionNo, s.arm, s.score, r.maxMarks, s.pct, s.minutes, s.flags, s.reason === "timeout" ? "time ran out" : s.reason === "integrity" ? "integrity rules" : s.reason === "staff" ? "staff" : "student"]),
      };
    return {
      name: `${base} topics`,
      columns: ["Topic", "Questions", "% correct", ...r.armNames],
      rows: r.topics.map((t) => [t.name, t.questions, t.pct, ...r.armNames.map((a) => t.arms[a] ?? null)]),
    };
  }
  if (key === "topics") {
    const m = await topicMastery(scope, access, { termId: p.term ?? "", subjectId: p.subject });
    return {
      name: `${m.subject?.name ?? "Subject"} topic mastery`,
      columns: ["Topic", "Questions", "Answers", "% correct", ...m.arms],
      rows: m.topics.map((t) => [t.name, t.questions, t.answers, t.pct, ...t.cells.map((c) => c.pct)]),
    };
  }
  const o = await schoolOverview(scope, access, p.term ?? "");
  if (key === "subjects")
    return {
      name: `Subjects ${o.term.label}`,
      columns: ["Subject", "Students", "Average %", "Pass rate %", "Below 40", `Change since ${o.previous?.label ?? "last term"}`],
      rows: o.subjects.map((s) => [s.name, s.students, s.average, s.passRate, s.below, s.change]),
    };
  if (key === "classes")
    return { name: `Classes ${o.term.label}`, columns: ["Class", "Students", "Average %", "Pass rate %"], rows: o.arms.map((a) => [a.arm, a.students, a.average, a.passRate]) };
  return {
    name: `Students at risk ${o.term.label}`,
    columns: ["Name", "Admission no.", "Class", "Average %", "Last term %", "Change", "Weakest subject", "Why"],
    rows: o.atRisk.map((s) => [s.name, s.admissionNo, s.arm, s.average, s.previous, s.change, s.weakest, s.reason === "below" ? "average below 40" : "dropped 10+ points"]),
  };
}
