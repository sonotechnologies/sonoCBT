import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/pdf/assets";

/**
 * Paystack (test mode). Set PAYSTACK_SECRET_KEY to a sk_test_ key. For local
 * development and the end-to-end tests without keys, PAYSTACK_MOCK=1 points
 * the same calls at a stand-in checkout inside the app (never with a live key).
 */

export class PaymentError extends Error {}

export function mockMode(): boolean {
  return process.env.PAYSTACK_MOCK === "1" && !(process.env.PAYSTACK_SECRET_KEY ?? "").startsWith("sk_live");
}

export function secretKey(): string | null {
  if (mockMode()) return process.env.PAYSTACK_SECRET_KEY || "sk_test_mock_secret";
  return process.env.PAYSTACK_SECRET_KEY || null;
}

export function paymentsReady(): boolean {
  return !!secretKey();
}

function baseUrl(): string {
  return mockMode() ? `${appUrl()}/api/paystack-mock` : "https://api.paystack.co";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = secretKey();
  if (!key) throw new PaymentError("Payments aren't set up yet (PAYSTACK_SECRET_KEY).");
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new PaymentError("Couldn't reach Paystack. Check your connection and try again.");
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !body?.status) throw new PaymentError(body?.message ? `Paystack: ${body.message}` : `Paystack error (${res.status}).`);
  return body.data as T;
}

/** Starts a payment; the school is sent to `authorizationUrl`. */
export async function initializeTransaction(p: { email: string; amountKobo: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
  const d = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({ email: p.email, amount: p.amountKobo, currency: "NGN", reference: p.reference, callback_url: p.callbackUrl, metadata: p.metadata }),
  });
  return { authorizationUrl: d.authorization_url };
}

export type VerifiedTransaction = { status: string; reference: string; amount: number; currency: string; id: number | string; channel: string | null; paidAt: string | null };

/** Asks Paystack what really happened to a payment (never trust the browser's redirect alone). */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const d = await call<{ status: string; reference: string; amount: number; currency: string; id: number; channel?: string; paid_at?: string | null }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: d.status, reference: d.reference, amount: d.amount, currency: d.currency, id: d.id, channel: d.channel ?? null, paidAt: d.paid_at ?? null };
}

/** Paystack signs each webhook body with HMAC-SHA512 using the secret key. */
export function signBody(raw: string, key = secretKey() ?? ""): string {
  return createHmac("sha512", key).update(raw).digest("hex");
}

export function validSignature(raw: string, signature: string | null): boolean {
  const key = secretKey();
  if (!key || !signature) return false;
  const a = Buffer.from(signBody(raw, key));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
