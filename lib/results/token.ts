import { createHmac, timingSafeEqual } from "node:crypto";

/** A short-lived, signed grant to view one student's report card for one term. */
export type ResultGrant = { schoolId: string; studentId: string; termId: string; exp: number };

export const RESULT_COOKIE = "sono_result";
export const RESULT_TTL_SECONDS = 30 * 60;

function secret(): string {
  const s = process.env.RESULTS_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("RESULTS_TOKEN_SECRET is not set. See .env.example.");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createResultToken(g: Omit<ResultGrant, "exp">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...g, exp: now + RESULT_TTL_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readResultToken(token: string | undefined, now = Date.now()): ResultGrant | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const g = JSON.parse(Buffer.from(payload, "base64url").toString()) as ResultGrant;
    return g.exp > now ? g : null;
  } catch {
    return null;
  }
}
