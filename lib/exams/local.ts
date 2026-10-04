/**
 * Device-side exam state: how answers kept on the device are merged with what
 * the server sent, which ones still need sending, and which clock to trust.
 * Pure and tiny: this ships in the exam runtime bundle.
 */
import type { AttemptResponse, DeviceEvent, RuntimeAnswer, RuntimePayload, SubmitSummary, SyncAnswer } from "./runtime-types";

export type LocalState = {
  attemptId: string;
  answers: Record<string, RuntimeAnswer>;
  currentIndex: number;
  /** Highest sequence number issued on this device. */
  seq: number;
  /** Highest sequence number the server has confirmed. */
  acked: number;
  /** serverTime − deviceTime at the last contact. */
  offset: number;
  /** Latest server time seen, to spot a page served from the offline cache. */
  seenServerNow: number;
  deadlineAt: number;
  /** Server time of the last confirmed save. */
  savedAt: number | null;
  /** The student (or the clock) asked to submit; keep trying until the server confirms. */
  submitting: "student" | "timeout" | null;
  done: SubmitSummary | null;
  /** Integrity events not yet confirmed by the server (sent with every sync, like answers). */
  events: DeviceEvent[];
  eventSeq: number;
  /** Times the server has counted the student leaving the window. */
  leaves: number;
};

export function isAnswered(r: AttemptResponse | null | undefined): boolean {
  if (!r) return false;
  if (r.kind === "choice") return r.optionIds.length > 0;
  if (r.kind === "text") return r.text.trim().length > 0;
  return true;
}

/**
 * Combines the page's data with what this device kept. For each question the
 * newer write (higher sequence) wins, so offline answers survive a reload and
 * answers from another device aren't overwritten by stale ones.
 */
export function mergeState(payload: RuntimePayload, local: LocalState | null, deviceNow: number): LocalState {
  const answers: Record<string, RuntimeAnswer> = { ...payload.answers };
  if (local && local.attemptId === payload.attemptId) {
    for (const [id, a] of Object.entries(local.answers)) {
      if (!answers[id] || answers[id].seq < a.seq) answers[id] = a;
    }
  }
  const mine = local && local.attemptId === payload.attemptId ? local : null;
  const maxSeq = Object.values(answers).reduce((m, a) => Math.max(m, a.seq), 0);
  // A page from the offline cache carries an old server time; keep the clock we last trusted.
  const fresh = !mine || payload.serverNow > mine.seenServerNow;
  return {
    attemptId: payload.attemptId,
    answers,
    currentIndex: mine && mine.seq >= payload.clientSeq ? Math.min(mine.currentIndex, payload.questions.length - 1) : payload.currentIndex,
    seq: Math.max(mine?.seq ?? 0, payload.clientSeq, maxSeq),
    acked: Math.max(mine?.acked ?? 0, payload.clientSeq),
    offset: fresh ? payload.serverNow - deviceNow : mine!.offset,
    seenServerNow: fresh ? payload.serverNow : mine!.seenServerNow,
    deadlineAt: fresh ? payload.deadlineAt : Math.max(mine!.deadlineAt, payload.deadlineAt),
    savedAt: mine?.savedAt ?? (payload.clientSeq ? payload.serverNow : null),
    submitting: mine?.submitting ?? null,
    done: mine?.done ?? null,
    events: mine?.events ?? [],
    eventSeq: Math.max(mine?.eventSeq ?? 0, payload.eventSeq ?? 0),
    leaves: mine?.leaves ?? 0,
  };
}

/** Answers the server hasn't confirmed yet. All of them go in every request, so a lost request loses nothing. */
export function pendingAnswers(s: Pick<LocalState, "answers" | "acked">): SyncAnswer[] {
  return Object.entries(s.answers)
    .filter(([, a]) => a.seq > s.acked)
    .map(([id, a]) => ({ id, response: a.response, flagged: a.flagged, seq: a.seq }));
}

/** Records a change with the next sequence number. */
export function withAnswer(s: LocalState, id: string, change: Partial<Pick<RuntimeAnswer, "response" | "flagged">>): LocalState {
  const prev = s.answers[id] ?? { response: null, flagged: false, seq: 0 };
  const seq = s.seq + 1;
  return { ...s, seq, answers: { ...s.answers, [id]: { ...prev, ...change, seq } } };
}

/** Adds an integrity event with the next event number, stamped on the server's clock. */
export function withEvent(s: LocalState, ev: Omit<DeviceEvent, "seq" | "at">, deviceNow: number): LocalState {
  const eventSeq = s.eventSeq + 1;
  return { ...s, eventSeq, events: [...s.events, { ...ev, seq: eventSeq, at: Math.round(deviceNow + s.offset) }].slice(-100) };
}

/** Seconds left on the server's clock (never negative). */
export function secondsLeft(s: Pick<LocalState, "deadlineAt" | "offset">, deviceNow: number): number {
  return Math.max(0, Math.ceil((s.deadlineAt - (deviceNow + s.offset)) / 1000));
}
