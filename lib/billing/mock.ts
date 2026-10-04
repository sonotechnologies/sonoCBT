import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { subscription, verification } from "@/lib/db/schema";
import { appUrl } from "@/lib/pdf/assets";
import { mockMode, webhookHash } from "./flutterwave";

/**
 * A stand-in for Flutterwave's API and hosted checkout, for development and
 * the end-to-end tests when no Flutterwave test keys are set
 * (FLUTTERWAVE_MOCK=1). Its record of each "payment" lives in the
 * verification table.
 */

type MockTx = { status: "successful" | "failed"; amount: number; currency: string; createdAt: string; id: number };
const key = (reference: string) => `flutterwave-mock:${reference}`;

export function assertMock() {
  if (!mockMode()) throw new Error("The Flutterwave stand-in is off. Set FLUTTERWAVE_MOCK=1 (development only).");
}

export async function mockTransaction(db: Db, reference: string): Promise<MockTx | null> {
  const [row] = await db.select().from(verification).where(eq(verification.identifier, key(reference)));
  return row ? (JSON.parse(row.value) as MockTx) : null;
}

/** The stand-in checkout's Pay / Decline buttons. Pay also sends the webhook, as Flutterwave would. Returns Flutterwave's transaction id. */
export async function mockComplete(db: Db, reference: string, outcome: "successful" | "failed"): Promise<number> {
  assertMock();
  const [sub] = await db.select().from(subscription).where(eq(subscription.reference, reference));
  if (!sub) throw new Error("Unknown payment.");
  // Flutterwave works in naira.
  const tx: MockTx = { status: outcome, amount: sub.amount / 100, currency: sub.currency, createdAt: new Date().toISOString(), id: Date.now() };
  await db.delete(verification).where(eq(verification.identifier, key(reference)));
  await db.insert(verification).values({ identifier: key(reference), value: JSON.stringify(tx), expiresAt: new Date(Date.now() + 86_400_000) });
  if (outcome === "successful") {
    const body = JSON.stringify({ event: "charge.completed", data: { id: tx.id, tx_ref: reference, status: "successful", amount: tx.amount, currency: tx.currency } });
    await fetch(`${appUrl()}/api/flutterwave/webhook`, { method: "POST", body, headers: { "Content-Type": "application/json", "verif-hash": webhookHash() ?? "" } }).catch(() => null);
  }
  return tx.id;
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
