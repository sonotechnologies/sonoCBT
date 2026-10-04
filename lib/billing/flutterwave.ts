import "server-only";
import { timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/pdf/assets";

/**
 * Flutterwave (v3, test mode). Set FLUTTERWAVE_SECRET_KEY to a FLWSECK_TEST-
 * key and FLUTTERWAVE_WEBHOOK_HASH to the secret hash you set on the
 * dashboard's webhook. For local development and the end-to-end tests without
 * keys, FLUTTERWAVE_MOCK=1 points the same calls at a stand-in checkout inside
 * the app (never with a live key).
 */

export class PaymentError extends Error {}

const isLive = (key: string) => key.startsWith("FLWSECK-");

export function mockMode(): boolean {
  return process.env.FLUTTERWAVE_MOCK === "1" && !isLive(process.env.FLUTTERWAVE_SECRET_KEY ?? "");
}

export function secretKey(): string | null {
  if (mockMode()) return process.env.FLUTTERWAVE_SECRET_KEY || "FLWSECK_TEST-mock";
  return process.env.FLUTTERWAVE_SECRET_KEY || null;
}

/** The secret hash Flutterwave sends in each webhook's `verif-hash` header. */
export function webhookHash(): string | null {
  if (mockMode()) return process.env.FLUTTERWAVE_WEBHOOK_HASH || "mock-webhook-hash";
  return process.env.FLUTTERWAVE_WEBHOOK_HASH || null;
}

export function paymentsReady(): boolean {
  return !!secretKey();
}

function baseUrl(): string {
  return mockMode() ? `${appUrl()}/api/flutterwave-mock` : "https://api.flutterwave.com";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: { status?: string; message?: string; data?: T } | null }> {
  const key = secretKey();
  if (!key) throw new PaymentError("Payments aren't set up yet (FLUTTERWAVE_SECRET_KEY).");
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new PaymentError("Couldn't reach Flutterwave. Check your connection and try again.");
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { status?: string; message?: string; data?: T } | null };
}

/** Starts a payment; the school is sent to `authorizationUrl`. Amounts are kobo here, naira for Flutterwave. */
export async function initializeTransaction(p: { email: string; name?: string; amountKobo: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
  const { status, body } = await call<{ link: string }>("/v3/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: p.reference,
      amount: p.amountKobo / 100,
      currency: "NGN",
      redirect_url: p.callbackUrl,
      customer: { email: p.email, ...(p.name ? { name: p.name } : {}) },
      customizations: { title: "SonoCBT", description: "School subscription for the term" },
      meta: p.metadata,
    }),
  });
  if (status >= 300 || body?.status !== "success" || !body.data?.link) {
    throw new PaymentError(body?.message ? `Flutterwave: ${body.message}` : `Flutterwave error (${status}).`);
  }
  return { authorizationUrl: body.data.link };
}

/** What we record about a payment; status is "success", "failed", or anything else for "not finished". */
export type VerifiedTransaction = { status: string; reference: string; amount: number; currency: string; id: number | string; channel: string | null; paidAt: string | null };

/** Asks Flutterwave what really happened to a payment (never trust the browser's redirect alone). Amount comes back in kobo. */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const { status, body } = await call<{ id: number; tx_ref: string; status: string; amount: number; currency: string; payment_type?: string; created_at?: string }>(
    `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
  );
  const d = body?.data;
  if (body?.status !== "success" || !d) {
    // Not paid yet (or abandoned): Flutterwave has no completed transaction for this reference.
    if (status === 404 || status === 400) return { status: "abandoned", reference, amount: 0, currency: "NGN", id: 0, channel: null, paidAt: null };
    throw new PaymentError(body?.message ? `Flutterwave: ${body.message}` : `Flutterwave error (${status}).`);
  }
  return {
    status: d.status === "successful" ? "success" : d.status === "failed" ? "failed" : d.status,
    reference: d.tx_ref,
    amount: Math.round(Number(d.amount) * 100),
    currency: d.currency,
    id: d.id,
    channel: d.payment_type ?? null,
    paidAt: d.created_at ?? null,
  };
}

/** Flutterwave proves a webhook is genuine by sending the secret hash in `verif-hash`. */
export function validWebhookHash(header: string | null): boolean {
  const expected = webhookHash();
  if (!expected || !header) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
