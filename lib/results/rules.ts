/** Pure rules for the results pipeline: components, grade scales, grid cells, pasted data. */
import { round, type GradeBand } from "@/lib/grading";

export type ComponentInput = { id?: string; name: string; weight: number };

/** A term's assessment components: named, whole-number weights, adding up to exactly 100. */
export function componentProblems(list: ComponentInput[]): string | null {
  if (!list.length) return "Add at least one component, e.g. Exam 100.";
  if (list.length > 10) return "Use at most 10 components.";
  const names = list.map((c) => c.name.trim());
  if (names.some((n) => !n)) return "Give every component a name.";
  if (names.some((n) => n.length > 30)) return "Keep component names short (30 letters).";
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return "Two components have the same name.";
  if (list.some((c) => !Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)) return "Each component is worth a whole number from 1 to 100.";
  const sum = list.reduce((a, c) => a + c.weight, 0);
  if (sum !== 100) return `The components add up to ${sum}. They must add up to 100.`;
  return null;
}

/** A grading scale: unique grades covering 0–100 with no gaps or overlaps (a 0.01 step between bands is fine). */
export function bandProblems(bands: GradeBand[]): string | null {
  if (bands.length < 2) return "Add at least two grades.";
  if (bands.some((b) => !b.grade.trim() || b.grade.length > 4)) return "Each grade needs a short name, e.g. A1.";
  if (new Set(bands.map((b) => b.grade.trim().toUpperCase())).size !== bands.length) return "Two bands have the same grade.";
  if (bands.some((b) => !(b.min >= 0 && b.max <= 100 && b.min <= b.max))) return "Each band runs from a lower to a higher score between 0 and 100.";
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  if (sorted[0].max !== 100) return "The top band must go up to 100.";
  if (sorted.at(-1)!.min !== 0) return "The bottom band must start at 0.";
  for (let i = 1; i < sorted.length; i++) {
    const gap = round(sorted[i - 1].min - sorted[i].max, 2);
    if (gap <= 0) return `${sorted[i - 1].grade} and ${sorted[i].grade} overlap.`;
    if (gap > 0.01) return `There's a gap between ${sorted[i].grade} (up to ${sorted[i].max}) and ${sorted[i - 1].grade} (from ${sorted[i - 1].min}).`;
  }
  return null;
}

export type CellIssue = "missing" | "too_high" | "not_a_number" | null;

/** "" is missing; anything else must be a number from 0 to the component's maximum. */
export function cellIssue(raw: string, max: number): CellIssue {
  const s = raw.trim();
  if (!s) return "missing";
  if (!/^\d+(\.\d+)?$/.test(s)) return "not_a_number";
  return Number(s) > max ? "too_high" : null;
}

/** Rows and cells copied from Excel or Google Sheets (tab-separated), or a CSV. */
export function parsePaste(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1")));
}

/** Exam marks scaled to a component: 15 of 22 counted towards "Exam /60" is 40.9. */
export function scaleScore(score: number, outOf: number, weight: number): number {
  if (outOf <= 0) return 0;
  return round(Math.min(score, outOf) * (weight / outOf), 1);
}
