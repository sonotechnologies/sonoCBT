/** Pure presentation rules for exams on the student side. */
import { formatDuration, formatTime, lagosDayKey, list } from "@/lib/format";

export type ExamLike = {
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  calculator: "off" | "basic" | "scientific";
  integrity: "practice" | "standard" | "strict";
  graded: boolean;
  venue: string | null;
  subjects: { name: string; shortName: string }[];
  questionCount: number;
};

export type ExamPhase = "upcoming" | "open" | "closed";

export function examPhase(e: Pick<ExamLike, "windowStart" | "windowEnd">, now: Date): ExamPhase {
  if (now < e.windowStart) return "upcoming";
  if (now < e.windowEnd) return "open";
  return "closed";
}

/** Eyebrow on the "Today" card: calm, specific, never alarming. */
export function opensLabel(e: Pick<ExamLike, "windowStart" | "windowEnd">, now: Date): string {
  const phase = examPhase(e, now);
  if (phase === "open") return "OPEN NOW";
  if (phase === "closed") return "CLOSED";
  const mins = Math.ceil((e.windowStart.getTime() - now.getTime()) / 60_000);
  if (mins <= 60) return `OPENS IN ${mins} MIN`;
  return `OPENS AT ${formatTime(e.windowStart)}`;
}

export function isToday(d: Date, now: Date): boolean {
  return lagosDayKey(d) === lagosDayKey(now);
}

/** "English, Maths, Basic Science · 1 hr 30 min · ICT Lab 2" */
export function todaySummary(e: ExamLike): string {
  return [list(e.subjects.map((s) => s.shortName)), formatDuration(e.durationMinutes), e.venue]
    .filter(Boolean)
    .join(" · ");
}

/** Second line in "Coming up". */
export function comingUpSummary(e: ExamLike): string {
  if (!e.graded) return "Practice · not graded";
  if (e.subjects.length > 1) return `${list(e.subjects.map((s) => s.shortName))} · ${formatTime(e.windowStart)}`;
  return `${e.questionCount} questions · ${formatDuration(e.durationMinutes)}`;
}

export type LobbyRule = { text: string; highlight?: boolean };

/** The lobby's rules, derived from the exam's settings. The save promise comes first and is highlighted. */
export function lobbyRules(e: Pick<ExamLike, "calculator" | "integrity">): LobbyRule[] {
  const rules: LobbyRule[] = [
    { text: "Your answers save as you go, even if the internet drops.", highlight: true },
    { text: "You can flag questions and come back to them." },
  ];
  if (e.integrity === "practice") rules.push({ text: "This is practice. Take your time and learn from it." });
  else if (e.integrity === "strict") rules.push({ text: "Stay in the exam window. Leaving is recorded, and leaving often ends the exam." });
  else rules.push({ text: "Stay in the exam window. Leaving is recorded." });
  rules.push({
    text:
      e.calculator === "off"
        ? "Calculators are not allowed in this paper."
        : `A ${e.calculator} calculator is available on screen.`,
  });
  return rules;
}
