/** Pure result computations: positions with ties, grades, class statistics. */

export type GradeBand = { min: number; max: number; grade: string; remark: string };

/** Default WAEC-style scale (editable per school). */
export const WAEC_BANDS: GradeBand[] = [
  { min: 75, max: 100, grade: "A1", remark: "Excellent" },
  { min: 70, max: 74.99, grade: "B2", remark: "Very good" },
  { min: 65, max: 69.99, grade: "B3", remark: "Good" },
  { min: 60, max: 64.99, grade: "C4", remark: "Credit" },
  { min: 55, max: 59.99, grade: "C5", remark: "Credit" },
  { min: 50, max: 54.99, grade: "C6", remark: "Credit" },
  { min: 45, max: 49.99, grade: "D7", remark: "Pass" },
  { min: 40, max: 44.99, grade: "E8", remark: "Pass" },
  { min: 0, max: 39.99, grade: "F9", remark: "Fail" },
];

export function gradeFor(score: number, bands: GradeBand[] = WAEC_BANDS): GradeBand | undefined {
  return bands.find((b) => score >= b.min && score <= b.max);
}

/** Round half away from zero to `dp` decimals (avoids 0.1 + 0.2 style drift in averages). */
export function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Standard competition ranking: equal values share a position and the next
 * position skips (1st, 2nd, 2nd, 4th). Higher is better.
 */
export function rank<K>(items: { key: K; value: number }[]): Map<K, number> {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const out = new Map<K, number>();
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    out.set(item.key, prev && prev.value === item.value ? out.get(prev.key)! : i + 1);
  });
  return out;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export type ComponentScore = { studentId: string; subjectId: string; componentId: string; value: number };

export type SubjectResult = {
  subjectId: string;
  /** Component id → score. */
  components: Record<string, number>;
  total: number;
  grade: string;
  remark: string;
  position: number;
  classAverage: number;
  highest: number;
  lowest: number;
};

export type StudentResult = {
  studentId: string;
  subjects: SubjectResult[];
  total: number;
  average: number;
  position: number;
};

export type ClassResults = {
  students: Map<string, StudentResult>;
  /** Number of students with at least one score. */
  numberInClass: number;
};

/**
 * Computes a class arm's term results from component scores. A student's
 * average is over the subjects they actually have scores in.
 */
export function computeClassResults(scores: ComponentScore[], bands: GradeBand[] = WAEC_BANDS): ClassResults {
  // student → subject → { componentId → value }
  const byStudent = new Map<string, Map<string, Record<string, number>>>();
  for (const s of scores) {
    const subjects = byStudent.get(s.studentId) ?? new Map<string, Record<string, number>>();
    const comps = subjects.get(s.subjectId) ?? {};
    comps[s.componentId] = s.value;
    subjects.set(s.subjectId, comps);
    byStudent.set(s.studentId, subjects);
  }

  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

  // subject → per-student totals
  const subjectTotals = new Map<string, { key: string; value: number }[]>();
  for (const [studentId, subjects] of byStudent) {
    for (const [subjectId, comps] of subjects) {
      const list = subjectTotals.get(subjectId) ?? [];
      list.push({ key: studentId, value: round(sum(comps), 2) });
      subjectTotals.set(subjectId, list);
    }
  }

  const subjectStats = new Map<
    string,
    { positions: Map<string, number>; classAverage: number; highest: number; lowest: number }
  >();
  for (const [subjectId, list] of subjectTotals) {
    const values = list.map((l) => l.value);
    subjectStats.set(subjectId, {
      positions: rank(list),
      classAverage: round(values.reduce((a, b) => a + b, 0) / values.length, 1),
      highest: Math.max(...values),
      lowest: Math.min(...values),
    });
  }

  const students = new Map<string, StudentResult>();
  for (const [studentId, subjects] of byStudent) {
    const rows: SubjectResult[] = [];
    for (const [subjectId, comps] of subjects) {
      const total = round(sum(comps), 2);
      const stats = subjectStats.get(subjectId)!;
      const band = gradeFor(total, bands);
      rows.push({
        subjectId,
        components: comps,
        total,
        grade: band?.grade ?? "—",
        remark: band?.remark ?? "",
        position: stats.positions.get(studentId)!,
        classAverage: stats.classAverage,
        highest: stats.highest,
        lowest: stats.lowest,
      });
    }
    const total = round(rows.reduce((a, r) => a + r.total, 0), 2);
    students.set(studentId, { studentId, subjects: rows, total, average: round(total / rows.length, 1), position: 0 });
  }

  // Class position by average (ties share a position). Rank on the unrounded
  // average so students who differ only past the first decimal aren't tied.
  const positions = rank(
    [...students.values()].map((s) => ({ key: s.studentId, value: s.total / s.subjects.length })),
  );
  for (const s of students.values()) s.position = positions.get(s.studentId)!;

  return { students, numberInClass: students.size };
}
