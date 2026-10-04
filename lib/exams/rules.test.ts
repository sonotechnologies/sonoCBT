import { beforeAll, describe, expect, it } from "vitest";
import type { ExamQuestionSnapshot } from "@/lib/db/schema";
import { examPinMatches, generateExamPin, hashExamPin, normaliseExamPin, sealPin, unsealPin } from "./pin";
import { attemptDeadline, buildOrder, canStart, isOverdue, markResponse, SYNC_GRACE_MS, validResponse, type OrderInput } from "./rules";

const doc = { type: "doc" as const, content: [] };
const q = (over: Partial<ExamQuestionSnapshot>): ExamQuestionSnapshot => ({
  type: "mcq_single",
  stem: doc,
  options: ["a", "b", "c", "d"].map((id) => ({ id, content: doc, isCorrect: id === "b" })),
  answer: { kind: "mcq_single" },
  passage: null,
  code: "MTH-0001",
  topicName: null,
  ...over,
});

describe("per-student order", () => {
  const items: OrderInput[] = [
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, sectionOrder: 1, sortOrder: n, passageId: "P", type: "mcq_single" as const, optionIds: ["a", "b", "c", "d"] })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, sectionOrder: 1, sortOrder: 10 + i, passageId: null, type: "mcq_single" as const, optionIds: ["a", "b", "c", "d"] })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, sectionOrder: 2, sortOrder: i, passageId: null, type: "true_false" as const, optionIds: ["t", "f"] })),
  ];
  const on = { shuffleQuestions: true, shuffleOptions: true };

  it("is the same for the same seed and differs between students", () => {
    expect(buildOrder(items, on, "student-1")).toEqual(buildOrder(items, on, "student-1"));
    expect(buildOrder(items, on, "student-1").questionOrder).not.toEqual(buildOrder(items, on, "student-2").questionOrder);
  });

  it("keeps sections in order and passage questions together, in their set order", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const { questionOrder } = buildOrder(items, on, seed);
      expect(questionOrder).toHaveLength(25);
      expect(questionOrder.slice(15).every((id) => id.startsWith("m"))).toBe(true);
      const start = questionOrder.indexOf("p1");
      expect(questionOrder.slice(start, start + 5)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    }
  });

  it("shuffles options but never True/False, and not at all when switched off", () => {
    const shuffled = Object.values(buildOrder(items, on, "x").optionOrder).filter((o) => o.length === 4);
    expect(shuffled.some((o) => o.join("") !== "abcd")).toBe(true);
    expect(buildOrder(items, on, "x").optionOrder.m0).toEqual(["t", "f"]);
    const off = buildOrder(items, { shuffleQuestions: false, shuffleOptions: false }, "x");
    expect(off.questionOrder).toEqual(items.map((i) => i.id));
    expect(Object.values(off.optionOrder).every((o) => o.join("") === "abcd" || o.join("") === "tf")).toBe(true);
  });
});

describe("time", () => {
  const exam = { windowStart: new Date("2026-09-29T09:00:00Z"), windowEnd: new Date("2026-09-29T11:00:00Z"), lateEntryUntil: new Date("2026-09-29T09:15:00Z"), durationMinutes: 90 };

  it("gives the full duration when started on time", () => {
    expect(attemptDeadline(exam, new Date("2026-09-29T09:05:00Z")).toISOString()).toBe("2026-09-29T10:35:00.000Z");
  });

  it("cuts a late start at the window end, then adds extra time", () => {
    const late = new Date("2026-09-29T10:00:00Z");
    expect(attemptDeadline(exam, late).toISOString()).toBe("2026-09-29T11:00:00.000Z");
    expect(attemptDeadline(exam, late, 300).toISOString()).toBe("2026-09-29T11:05:00.000Z");
  });

  it("only lets students start inside the window and before late entry closes", () => {
    expect(canStart(exam, new Date("2026-09-29T08:59:00Z"))).toMatchObject({ ok: false, reason: "not_open" });
    expect(canStart(exam, new Date("2026-09-29T09:10:00Z"))).toEqual({ ok: true });
    expect(canStart(exam, new Date("2026-09-29T09:20:00Z"))).toMatchObject({ ok: false, reason: "late" });
    expect(canStart(exam, new Date("2026-09-29T11:00:00Z"))).toMatchObject({ ok: false, reason: "closed" });
    expect(canStart({ ...exam, lateEntryUntil: null }, new Date("2026-09-29T10:59:00Z"))).toEqual({ ok: true });
  });

  it("allows a short grace for answers already in flight", () => {
    const d = new Date("2026-09-29T10:35:00Z");
    expect(isOverdue(d, new Date(d.getTime() + SYNC_GRACE_MS - 1))).toBe(false);
    expect(isOverdue(d, new Date(d.getTime() + SYNC_GRACE_MS + 1))).toBe(true);
  });
});

describe("marking", () => {
  it("marks single choice", () => {
    expect(markResponse(q({}), 2, { kind: "choice", optionIds: ["b"] })).toEqual({ isCorrect: true, marksAwarded: 2 });
    expect(markResponse(q({}), 2, { kind: "choice", optionIds: ["a"] })).toEqual({ isCorrect: false, marksAwarded: 0 });
    expect(markResponse(q({}), 2, null)).toEqual({ isCorrect: false, marksAwarded: 0 });
  });

  it("marks multiple answer, all-or-nothing and partial", () => {
    const opts = ["a", "b", "c", "d"].map((id) => ({ id, content: doc, isCorrect: id === "a" || id === "c" }));
    const aon = q({ type: "mcq_multi", options: opts, answer: { kind: "mcq_multi", scoring: "all_or_nothing" } });
    const partial = q({ type: "mcq_multi", options: opts, answer: { kind: "mcq_multi", scoring: "partial" } });
    expect(markResponse(aon, 2, { kind: "choice", optionIds: ["c", "a"] }).marksAwarded).toBe(2);
    expect(markResponse(aon, 2, { kind: "choice", optionIds: ["a"] }).marksAwarded).toBe(0);
    expect(markResponse(partial, 2, { kind: "choice", optionIds: ["a"] })).toEqual({ isCorrect: false, marksAwarded: 1 });
  });

  it("marks true/false, fill-in-the-gap and numeric", () => {
    expect(markResponse(q({ type: "true_false", options: [], answer: { kind: "true_false", correct: false } }), 1, { kind: "bool", value: false }).marksAwarded).toBe(1);
    const gap = q({ type: "fill_blank", options: [], answer: { kind: "fill_blank", accepted: ["newton", "N"], caseSensitive: false } });
    expect(markResponse(gap, 1, { kind: "text", text: " Newton. " }).marksAwarded).toBe(1);
    const num = q({ type: "numeric", options: [], answer: { kind: "numeric", value: 0.75, tolerance: 0.01 } });
    expect(markResponse(num, 1, { kind: "text", text: "3/4" }).marksAwarded).toBe(1);
    expect(markResponse(num, 1, { kind: "text", text: "0.8" }).marksAwarded).toBe(0);
  });

  it("leaves theory for a teacher, but scores a blank theory answer 0", () => {
    const theory = q({ type: "theory", options: [], answer: { kind: "theory", markingGuide: null } });
    expect(markResponse(theory, 10, { kind: "text", text: "Clear stagnant water." })).toEqual({ isCorrect: null, marksAwarded: null });
    expect(markResponse(theory, 10, { kind: "text", text: "  " })).toEqual({ isCorrect: null, marksAwarded: 0 });
  });

  it("rejects responses that don't fit the question", () => {
    expect(validResponse(q({}), { kind: "choice", optionIds: ["b"] })).toBe(true);
    expect(validResponse(q({}), { kind: "choice", optionIds: ["b", "c"] })).toBe(false);
    expect(validResponse(q({}), { kind: "choice", optionIds: ["zz"] })).toBe(false);
    expect(validResponse(q({}), { kind: "text", text: "b" })).toBe(false);
    expect(validResponse(q({}), null)).toBe(true);
  });
});

describe("exam PINs", () => {
  beforeAll(() => {
    process.env.RESULTS_TOKEN_SECRET ||= "test-secret-for-exam-pins";
  });

  it("are easy to read and forgiving to type", () => {
    const pin = generateExamPin();
    expect(pin).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(pin).not.toMatch(/[01OILS5]/);
    expect(normaliseExamPin(" 7k4q 29xm ")).toBe("7K4Q-29XM");
  });

  it("only match their own exam and student", () => {
    const h = hashExamPin("exam-1", "stu-1", "7K4Q-29XM");
    expect(examPinMatches(h, "exam-1", "stu-1", "7k4q29xm")).toBe(true);
    expect(examPinMatches(h, "exam-1", "stu-2", "7K4Q-29XM")).toBe(false);
    expect(examPinMatches(h, "exam-2", "stu-1", "7K4Q-29XM")).toBe(false);
  });

  it("can be unsealed for reprinting, and tampering is caught", () => {
    const sealed = sealPin("7K4Q-29XM");
    expect(sealed).not.toContain("7K4Q");
    expect(unsealPin(sealed)).toBe("7K4Q-29XM");
    const [iv, tag, body] = sealed.split(".");
    expect(() => unsealPin([iv, tag, body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA")].join("."))).toThrow();
  });
});
