import { describe, expect, it } from "vitest";
import { comingUpSummary, lobbyRules, opensLabel, todaySummary, type ExamLike } from "./present";

const base: ExamLike = {
  windowStart: new Date("2026-09-27T08:30:00Z"), // 09:30 Lagos
  windowEnd: new Date("2026-09-27T11:30:00Z"),
  durationMinutes: 90,
  calculator: "off",
  integrity: "standard",
  graded: true,
  venue: "ICT Lab 2",
  subjects: [
    { name: "English Language", shortName: "English" },
    { name: "Mathematics", shortName: "Maths" },
    { name: "Basic Science", shortName: "Basic Science" },
  ],
  questionCount: 30,
};

describe("opensLabel", () => {
  it("counts down in minutes within the hour", () => {
    expect(opensLabel(base, new Date("2026-09-27T08:18:00Z"))).toBe("OPENS IN 12 MIN");
  });
  it("shows the clock time when more than an hour away", () => {
    expect(opensLabel(base, new Date("2026-09-27T06:00:00Z"))).toBe("OPENS AT 09:30");
  });
  it("says open once the window starts, closed after it ends", () => {
    expect(opensLabel(base, new Date("2026-09-27T08:30:00Z"))).toBe("OPEN NOW");
    expect(opensLabel(base, new Date("2026-09-27T11:30:00Z"))).toBe("CLOSED");
  });
});

describe("summaries", () => {
  it("matches the Today card", () => {
    expect(todaySummary(base)).toBe("English, Maths, Basic Science · 1 hr 30 min · ICT Lab 2");
  });
  it("uses subjects and start time for multi-subject papers", () => {
    expect(comingUpSummary(base)).toBe("English, Maths, Basic Science · 09:30");
  });
  it("uses questions and duration for single-subject tests", () => {
    expect(
      comingUpSummary({ ...base, subjects: [base.subjects[0]], questionCount: 20, durationMinutes: 30 }),
    ).toBe("20 questions · 30 min");
  });
  it("marks ungraded practice", () => {
    expect(comingUpSummary({ ...base, graded: false })).toBe("Practice · not graded");
  });
});

describe("lobbyRules", () => {
  it("leads with the save promise and reflects calculator and integrity settings", () => {
    const rules = lobbyRules(base);
    expect(rules[0]).toEqual({ text: "Your answers save as you go, even if the internet drops.", highlight: true });
    expect(rules.map((r) => r.text)).toContain("Stay in the exam window. Leaving is recorded.");
    expect(rules.at(-1)?.text).toBe("Calculators are not allowed in this paper.");
    expect(lobbyRules({ ...base, calculator: "scientific" }).at(-1)?.text).toBe(
      "A scientific calculator is available on screen.",
    );
  });
});
