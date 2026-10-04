import { getDb } from "@/lib/db";
import { validSignature, verifyTransaction } from "@/lib/billing/paystack";
import { applyTransaction } from "@/lib/billing/service";

/**
 * Paystack webhook (set its URL to /api/paystack/webhook in the Paystack
 * dashboard). The body must carry Paystack's signature; even then we ask
 * Paystack for the transaction rather than trusting the body's figures.
 * Always answers 200 for events we've handled or don't need, so Paystack
 * doesn't keep retrying.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-paystack-signature"))) return new Response("Bad signature", { status: 401 });
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  if (event.event !== "charge.success" || !event.data?.reference) return new Response("ignored");
  const verified = await verifyTransaction(event.data.reference);
  const r = await applyTransaction(getDb(), verified);
  return Response.json({ ok: true, outcome: r.outcome });
}
