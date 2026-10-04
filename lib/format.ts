/** Nigerian defaults: Africa/Lagos, DD/MM/YYYY, 24-hour times. */
export const TIME_ZONE = "Africa/Lagos";

const parts = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, ...opts }).formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** 27/09/2026 */
export function formatDate(d: Date): string {
  const p = parts(d, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.day}/${p.month}/${p.year}`;
}

/** 09:30 */
export function formatTime(d: Date): string {
  const p = parts(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** { day: "29", month: "SEP" } for date blocks. (en-GB's short form is "Sept", so map it ourselves.) */
export function dayMonth(d: Date): { day: string; month: string } {
  const p = parts(d, { day: "2-digit", month: "numeric" });
  return { day: p.day, month: MONTHS[Number(p.month) - 1] };
}

/** Lagos calendar day key, e.g. "2026-09-27". */
export function lagosDayKey(d: Date): string {
  const p = parts(d, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Lagos is UTC+1 all year (no daylight saving). "2026-09-29" + "10:00" → that instant. */
export function fromLagos(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** For date and time inputs: { date: "2026-09-29", time: "10:00" } in Lagos. */
export function toLagos(d: Date): { date: string; time: string } {
  return { date: lagosDayKey(d), time: formatTime(d) };
}

/** 90 → "1 hr 30 min", 30 → "30 min", 120 → "2 hr" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export const TERM_ORDINAL = ["", "1st", "2nd", "3rd"];

/** "3rd Term 2025/2026"; pass a separator for "3rd Term · 2025/2026". */
export function termLabel(termNumber: number, sessionName: string, sep = " "): string {
  return `${TERM_ORDINAL[termNumber] ?? `${termNumber}th`} Term${sep}${sessionName}`;
}

/** Joins with commas: ["English", "Maths", "Basic Science"] → "English, Maths, Basic Science" */
export function list(items: string[]): string {
  return items.join(", ");
}

/** Long form with an ampersand: "English, Mathematics & Basic Science" */
export function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}`;
}

/** Formats a score without trailing ".0": 17 → "17", 71.4 → "71.4" */
export function num(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(dp).replace(/\.0+$/, "");
}
