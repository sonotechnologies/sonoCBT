import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** No 0/O, 1/I/L, 5/S: easy to read off a slip and type. Printed as "7K4Q-29XM". */
const ALPHABET = "2346789ABCDEFGHJKMNPQRTUVWXYZ";

export function generateExamPin(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Forgiving about case, spaces and the dash. */
export function normaliseExamPin(input: string): string {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

function secret(): string {
  const s = process.env.RESULTS_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("RESULTS_TOKEN_SECRET is not set. See .env.example.");
  return s;
}

/** Bound to the exam and student, so a PIN only opens its own slip's exam. */
export function hashExamPin(examId: string, studentId: string, pin: string): string {
  return createHmac("sha256", secret()).update(`exam-pin:${examId}:${studentId}:${normaliseExamPin(pin)}`).digest("hex");
}

export function examPinMatches(hash: string, examId: string, studentId: string, pin: string): boolean {
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashExamPin(examId, studentId, pin), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const key = () => createHash("sha256").update(`exam-pin-seal:${secret()}`).digest();

/** AES-256-GCM, so staff can reprint slips without PINs sitting in the database in plain text. */
export function sealPin(pin: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(pin, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unsealPin(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}
