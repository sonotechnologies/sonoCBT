/**
 * Integrity rules shared by the server and the monitor: which events count
 * against a student, network allow-lists, and how the monitor describes things.
 * Pure; no I/O.
 */

export type EventType =
  | "started"
  | "resumed"
  | "tab_hidden"
  | "fullscreen_exit"
  | "copy"
  | "paste"
  | "multi_session"
  | "device_moved"
  | "snapshot"
  | "snapshot_declined"
  | "blocked_ip"
  | "auto_submitted"
  | "submitted"
  | "extra_time"
  | "session_reset"
  | "force_submitted"
  | "late_answers_accepted";

/** Events a device may report. Everything else is recorded by the server. */
export const DEVICE_EVENTS = new Set<EventType>(["tab_hidden", "fullscreen_exit", "copy", "paste", "snapshot_declined"]);

/** Events that raise the student's flag on the monitor. */
export const FLAG_EVENTS = new Set<EventType>(["tab_hidden", "fullscreen_exit", "copy", "paste", "multi_session", "snapshot_declined", "blocked_ip"]);

// ─── Networks ────────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** "10.0.0.0/8", "102.89.4.17", or an exact IPv6 address. */
export function validNetwork(rule: string): boolean {
  const r = rule.trim();
  if (r.includes(":")) return /^[0-9a-f:]+$/i.test(r);
  const [ip, bits] = r.split("/");
  return ipv4ToInt(ip) !== null && (bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32));
}

export function ipAllowed(ip: string | null, rules: string[] | undefined): boolean {
  const list = (rules ?? []).map((r) => r.trim()).filter(Boolean);
  if (!list.length) return true;
  if (!ip) return false;
  const addr = ip.replace(/^::ffff:/, "");
  const n = ipv4ToInt(addr);
  return list.some((rule) => {
    if (rule.includes(":") || n === null) return rule.toLowerCase() === addr.toLowerCase();
    const [net, bits = "32"] = rule.split("/");
    const base = ipv4ToInt(net);
    if (base === null) return false;
    const b = Number(bits);
    const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
    return ((n & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

/** The caller's address, as the hosting platform reports it. */
export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
}

// ─── Monitor ─────────────────────────────────────────────────────────────────

/** A device that hasn't been heard from for this long is shown as offline. */
export const OFFLINE_AFTER_MS = 60_000;
/** …and after this long another device may take over the exam without the invigilator. */
export const TAKEOVER_AFTER_MS = 120_000;

export type MonitorStatus = "notstarted" | "progress" | "offline" | "flagged" | "submitted";

export function monitorStatus(
  a: { status: "in_progress" | "submitted" | "auto_submitted"; lastSeenAt: Date | null; integrityFlags: number } | null,
  now: Date,
): MonitorStatus {
  if (!a) return "notstarted";
  if (a.status !== "in_progress") return "submitted";
  if (!a.lastSeenAt || now.getTime() - a.lastSeenAt.getTime() > OFFLINE_AFTER_MS) return "offline";
  return a.integrityFlags > 0 ? "flagged" : "progress";
}

const secs = (ms: unknown) => {
  const s = Math.max(1, Math.round(Number(ms) / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};

export type Tone = "ok" | "warn" | "info" | "base";

/** One line of the monitor's timeline, in plain words. */
export function describeEvent(type: EventType, meta: Record<string, unknown> | null): { title: string; detail: string; tone: Tone } {
  const m = meta ?? {};
  switch (type) {
    case "started":
      return { title: "Started exam", detail: m.questions ? `${m.questions} questions` : "", tone: "ok" };
    case "resumed":
      return { title: "Came back", detail: "carried on where they stopped", tone: "base" };
    case "tab_hidden":
      return { title: "Left the exam window", detail: m.awayMs ? `for ${secs(m.awayMs)}` : "", tone: "warn" };
    case "fullscreen_exit":
      return { title: "Left full screen", detail: "", tone: "warn" };
    case "copy":
      return { title: "Tried to copy", detail: "blocked", tone: "warn" };
    case "paste":
      return { title: "Tried to paste", detail: "blocked", tone: "warn" };
    case "multi_session":
      return { title: "Second sign-in blocked", detail: m.where ? `from ${m.where}` : "on another device", tone: "warn" };
    case "device_moved":
      return { title: "Moved to another device", detail: "the first had gone quiet", tone: "info" };
    case "snapshot":
      return { title: "Photo taken", detail: "for identity", tone: "base" };
    case "snapshot_declined":
      return { title: "Didn't allow the camera", detail: "", tone: "warn" };
    case "blocked_ip":
      return { title: "Blocked: outside the school network", detail: String(m.ip ?? ""), tone: "warn" };
    case "auto_submitted":
      return {
        title: "Submitted automatically",
        detail: m.reason === "integrity" ? `after ${m.leaves ?? "too many"} tab switches` : "time ran out",
        tone: "warn",
      };
    case "submitted":
      return { title: "Submitted", detail: m.answered !== undefined ? `${m.answered} of ${m.total} answered` : "", tone: "ok" };
    case "extra_time":
      return { title: `Added ${m.minutes} minutes`, detail: m.by ? `by ${m.by}` : "", tone: "info" };
    case "session_reset":
      return { title: "Session reset", detail: m.by ? `by ${m.by}; can sign in on any computer` : "", tone: "info" };
    case "force_submitted":
      return { title: "Submitted by staff", detail: m.by ? `by ${m.by}${m.reason ? `: ${m.reason}` : ""}` : "", tone: "warn" };
    case "late_answers_accepted":
      return { title: "Late answers counted", detail: m.by ? `${m.count} by ${m.by}` : "", tone: "info" };
  }
}
