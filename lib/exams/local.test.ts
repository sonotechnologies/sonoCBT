import { describe, expect, it } from "vitest";
import { mergeState, pendingAnswers, secondsLeft, withAnswer, type LocalState } from "./local";
import type { RuntimePayload } from "./runtime-types";

const pick = (id: string) => ({ kind: "choice" as const, optionIds: [id] });

const payload = (over: Partial<RuntimePayload> = {}): RuntimePayload => ({
  attemptId: "att-1",
  syncUrl: "/sync",
  homeUrl: "/home",
  loginUrl: "/login",
  school: { name: "S", logoUrl: null },
  exam: { title: "T", series: null, fullTitle: null, calculator: "off", integrity: { fullscreen: "off", logTabSwitches: true, warnOnLeave: false, blockCopy: false, oneDevice: false, submitAfterLeaves: null, snapshot: false } },
  student: { name: "C O", firstName: "C", admissionNo: "1", className: null, photoUrl: null },
  sections: [{ title: "A" }],
  questions: ["q1", "q2", "q3"].map((id) => ({ id, sectionIndex: 0, type: "mcq_single", marks: 1, stemHtml: "", options: [], passageId: null })),
  passages: {},
  answers: { q1: { response: pick("a"), flagged: false, seq: 3 } },
  currentIndex: 1,
  clientSeq: 3,
  eventSeq: 0,
  deadlineAt: 1_000_000,
  serverNow: 400_000,
  ...over,
});

describe("device state", () => {
  it("starts from the page on a fresh device", () => {
    const s = mergeState(payload(), null, 100_000);
    expect(s).toMatchObject({ seq: 3, acked: 3, currentIndex: 1, offset: 300_000, deadlineAt: 1_000_000 });
    expect(pendingAnswers(s)).toEqual([]);
  });

  it("keeps offline answers from the device when the page reloads, and they stay pending", () => {
    let local = mergeState(payload(), null, 100_000);
    local = withAnswer(local, "q1", { response: pick("b") });
    local = withAnswer(local, "q2", { response: pick("c"), flagged: true });
    local = { ...local, currentIndex: 2 };
    // Reopened later: the (fresh) page still has the old q1 answer.
    const s = mergeState(payload({ serverNow: 460_000 }), local, 160_000);
    expect(s.answers.q1.response).toEqual(pick("b"));
    expect(s.answers.q2).toMatchObject({ response: pick("c"), flagged: true, seq: 5 });
    expect(s.currentIndex).toBe(2);
    expect(pendingAnswers(s).map((a) => a.id).sort()).toEqual(["q1", "q2"]);
  });

  it("lets a newer answer from another device win", () => {
    const local: LocalState = { ...mergeState(payload(), null, 0), answers: { q1: { response: pick("a"), flagged: false, seq: 3 } } };
    const s = mergeState(payload({ answers: { q1: { response: pick("d"), flagged: false, seq: 9 } }, clientSeq: 9, currentIndex: 2 }), local, 0);
    expect(s.answers.q1.response).toEqual(pick("d"));
    expect(s.seq).toBe(9);
    expect(s.currentIndex).toBe(2);
  });

  it("keeps the trusted clock when the page came from the offline cache", () => {
    // Last contact: server 700 000 when the device read 400 000; extra time moved the deadline.
    const local = { ...mergeState(payload(), null, 0), offset: 300_000, seenServerNow: 700_000, deadlineAt: 1_060_000 };
    const cached = mergeState(payload({ serverNow: 400_000 }), local, 450_000);
    expect(cached.offset).toBe(300_000);
    expect(cached.deadlineAt).toBe(1_060_000);
    // 1 060 000 − (450 000 + 300 000) = 310 s
    expect(secondsLeft(cached, 450_000)).toBe(310);
  });

  it("never shows negative time", () => {
    expect(secondsLeft({ deadlineAt: 1000, offset: 0 }, 5000)).toBe(0);
  });
});
