import { getDb } from "@/lib/db";
import { validWebhookHash, verifyTransaction } from "@/lib/billing/flutterwave";
import { applyTransaction } from "@/lib/billing/service";

/**
 * Flutterwave webhook (Settings → Webhooks on the dashboard: URL
 * https://<your domain>/api/flutterwave/webhook and the secret hash in
 * FLUTTERWAVE_WEBHOOK_HASH). The `verif-hash` header must match; even then we
 * ask Flutterwave for the transaction rather than trusting the body's figures.
 * Answers 200 for events we've handled or don't need, so it isn't retried.
 */
export async function POST(req: Request) {
  if (!validWebhookHash(req.headers.get("verif-hash"))) return new Response("Bad hash", { status: 401 });
  let event: { event?: string; data?: { tx_ref?: string } };
  try {
    event = await req.json();
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  if (event.event !== "charge.completed" || !event.data?.tx_ref) return new Response("ignored");
  const verified = await verifyTransaction(event.data.tx_ref);
  const r = await applyTransaction(getDb(), verified);
  return Response.json({ ok: true, outcome: r.outcome });
}
