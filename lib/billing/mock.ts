import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { subscription, verification } from "@/lib/db/schema";
import { appUrl } from "@/lib/pdf/assets";
import { mockMode, signBody } from "./paystack";

/**
 * A stand-in for Paystack's API and checkout page, for development and the
 * end-to-end tests when no Paystack test keys are set (PAYSTACK_MOCK=1).
 * Its record of each "payment" lives in the verification table.
 */

type MockTx = { status: "success" | "failed" | "abandoned"; amount: number; currency: string; paidAt: string | null; id: string };
const key = (reference: string) => `paystack-mock:${reference}`;

export function assertMock() {
  if (!mockMode()) throw new Error("The Paystack stand-in is off. Set PAYSTACK_MOCK=1 (development only).");
}

export async function mockTransaction(db: Db, reference: string): Promise<MockTx | null> {
  const [row] = await db.select().from(verification).where(eq(verification.identifier, key(reference)));
  return row ? (JSON.parse(row.value) as MockTx) : null;
}

/** The stand-in checkout's Pay / Cancel buttons. Pay also sends a signed webhook, as Paystack would. */
export async function mockComplete(db: Db, reference: string, outcome: "success" | "failed") {
  assertMock();
  const [sub] = await db.select().from(subscription).where(eq(subscription.reference, reference));
  if (!sub) throw new Error("Unknown payment.");
  const tx: MockTx = { status: outcome, amount: sub.amount, currency: sub.currency, paidAt: outcome === "success" ? new Date().toISOString() : null, id: `mock_${Date.now()}` };
  await db.delete(verification).where(eq(verification.identifier, key(reference)));
  await db.insert(verification).values({ identifier: key(reference), value: JSON.stringify(tx), expiresAt: new Date(Date.now() + 86_400_000) });
  if (outcome === "success") {
    const body = JSON.stringify({ event: "charge.success", data: { reference, amount: tx.amount, currency: tx.currency, status: "success" } });
    await fetch(`${appUrl()}/api/paystack/webhook`, { method: "POST", body, headers: { "Content-Type": "application/json", "x-paystack-signature": signBody(body) } }).catch(() => null);
  }
}

/** Only send people back to our own site. */
export function safeCallback(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin === new URL(appUrl()).origin ? u.toString() : null;
  } catch {
    return null;
  }
}
