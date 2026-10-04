/**
 * The exam runtime's wire format: what the page is given and what the small
 * sync API accepts and returns. Shared by server and client; nothing here may
 * reveal a correct answer.
 */
import type { AttemptResponse, IntegritySettings } from "@/lib/db/schema";

export type { AttemptResponse };

export type QuestionType = "mcq_single" | "mcq_multi" | "true_false" | "fill_blank" | "numeric" | "theory";

export type RuntimeQuestion = {
  /** exam_question id */
  id: string;
  sectionIndex: number;
  type: QuestionType;
  marks: number;
  stemHtml: string;
  /** In this student's order. True/false uses ids "true" and "false". */
  options: { id: string; html: string }[];
  passageId: string | null;
};

export type RuntimePassage = { id: string; title: string; html: string; label: string };

export type RuntimeAnswer = { response: AttemptResponse | null; flagged: boolean; seq: number };

export type RuntimePayload = {
  attemptId: string;
  syncUrl: string;
  homeUrl: string;
  loginUrl: string;
  school: { name: string; logoUrl: string | null };
  exam: {
    title: string;
    series: string | null;
    fullTitle: string | null;
    calculator: "off" | "basic" | "scientific";
    integrity: IntegritySettings;
  };
  student: { name: string; firstName: string; admissionNo: string; className: string | null; photoUrl: string | null };
  sections: { title: string }[];
  questions: RuntimeQuestion[];
  passages: Record<string, RuntimePassage>;
  answers: Record<string, RuntimeAnswer>;
  currentIndex: number;
  clientSeq: number;
  /** Highest integrity event number the server has; a new device carries on from here. */
  eventSeq: number;
  deadlineAt: number;
  serverNow: number;
};

export type SyncAnswer = { id: string; response: AttemptResponse | null; flagged: boolean; seq: number };

/** Something the device noticed: leaving the window, leaving full screen, a blocked copy or paste. */
export type DeviceEvent = {
  seq: number;
  type: "tab_hidden" | "fullscreen_exit" | "copy" | "paste" | "snapshot_declined";
  /** Server time (device clock corrected by the last known offset). */
  at: number;
  awayMs?: number;
};

export type SyncRequest = {
  attemptId: string;
  deviceSessionId: string;
  currentIndex: number;
  answers: SyncAnswer[];
  events?: DeviceEvent[];
  submit?: boolean;
};

export type SubmitSummary = {
  submittedAt: number;
  answered: number;
  total: number;
  /** Only when the exam shows scores straight away and nothing waits for a teacher. */
  score: { score: number; max: number } | null;
  auto: boolean;
  /** Why it ended: the student, the clock, the integrity rules (too many tab switches), or staff. */
  reason: "student" | "timeout" | "integrity" | "staff" | null;
};

export type SyncResponse =
  | { ok: true; status: "in_progress"; serverNow: number; deadlineAt: number; ackSeq: number; eventAck: number; leaves: number }
  | { ok: true; status: "submitted"; serverNow: number; summary: SubmitSummary; ackSeq: number; eventAck: number; lateCount: number }
  /** blocked: open on another device, or outside the school network. */
  | { ok: false; error: string; blocked?: "device" | "network" };
