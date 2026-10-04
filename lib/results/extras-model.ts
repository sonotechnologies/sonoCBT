/**
 * Report-card extras that teachers fill in: ratings, remarks and attendance.
 * Shared by the server and the editing screen, so no server imports here.
 */

export type RatingItem = { key: string; name: string };

export const AFFECTIVE: RatingItem[] = [
  { key: "punctuality", name: "Punctuality" },
  { key: "neatness", name: "Neatness" },
  { key: "politeness", name: "Politeness" },
  { key: "honesty", name: "Honesty" },
  { key: "relationship", name: "Relationship with others" },
  { key: "attentiveness", name: "Attentiveness" },
];

export const PSYCHOMOTOR: RatingItem[] = [
  { key: "handwriting", name: "Handwriting" },
  { key: "sports", name: "Sports and games" },
  { key: "drawing", name: "Drawing and painting" },
  { key: "crafts", name: "Crafts" },
  { key: "music", name: "Musical skills" },
  { key: "verbal", name: "Verbal fluency" },
];

export const RATING_KEY = "5 Excellent · 4 Very good · 3 Good · 2 Fair · 1 Poor";

export const REMARK_MAX = 300;

export type ExtrasInput = {
  formTeacherRemark?: string | null;
  principalRemark?: string | null;
  affective?: Record<string, number>;
  psychomotor?: Record<string, number>;
  daysPresent?: number | null;
  daysOpened?: number | null;
};

/** Problems with a set of extras, or null. */
export function extrasProblem(e: ExtrasInput): string | null {
  for (const [label, r, items] of [
    ["Affective", e.affective, AFFECTIVE],
    ["Psychomotor", e.psychomotor, PSYCHOMOTOR],
  ] as const) {
    for (const [k, v] of Object.entries(r ?? {})) {
      if (!items.some((i) => i.key === k)) return `${label}: unknown rating "${k}".`;
      if (!Number.isInteger(v) || v < 1 || v > 5) return `${label} ratings are 1 to 5.`;
    }
  }
  const { daysPresent: p, daysOpened: o } = e;
  for (const [label, v] of [
    ["Days present", p],
    ["Days school opened", o],
  ] as const) {
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0 || v > 400)) return `${label} must be a whole number from 0 to 400.`;
  }
  if (p != null && o != null && p > o) return "Days present can't be more than the days school opened.";
  for (const r of [e.formTeacherRemark, e.principalRemark]) if (r && r.length > REMARK_MAX) return `Keep remarks under ${REMARK_MAX} characters.`;
  return null;
}

/** A starting point for the principal's remark, from the student's average. The principal can change it. */
export function suggestPrincipalRemark(average: number): string {
  if (average >= 75) return "An excellent result. Keep it up.";
  if (average >= 65) return "A very good result. Well done.";
  if (average >= 55) return "A good result. Aim higher next term.";
  if (average >= 45) return "A fair result. More effort is needed.";
  if (average >= 40) return "A weak pass. Work much harder next term.";
  return "A poor result. See the form teacher about extra support.";
}
