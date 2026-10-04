import { getDb } from "@/lib/db";
import { mockMode, secretKey } from "@/lib/billing/flutterwave";
import { mockTransaction } from "@/lib/billing/mock";
import { appUrl } from "@/lib/pdf/assets";

/** Flutterwave's two API calls we use, faked for development (FLUTTERWAVE_MOCK=1). Off otherwise. */
function guard(req: Request): Response | null {
  if (!mockMode()) return new Response("Not found", { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${secretKey()}`) return Response.json({ status: "error", message: "Invalid authorization key" }, { status: 401 });
  return null;
}

export async function POST(req: Request, ctx: RouteContext<"/api/flutterwave-mock/[...path]">) {
  const bad = guard(req);
  if (bad) return bad;
  const { path } = await ctx.params;
  if (path.join("/") !== "v3/payments") return new Response("Not found", { status: 404 });
  const b = (await req.json()) as { tx_ref: string; amount: number; redirect_url: string; customer: { email: string } };
  const q = new URLSearchParams({ tx_ref: b.tx_ref, amount: String(b.amount), email: b.customer.email, callback: b.redirect_url });
  return Response.json({ status: "success", message: "Hosted Link", data: { link: `${appUrl()}/dev/flutterwave-checkout?${q}` } });
}

export async function GET(req: Request, ctx: RouteContext<"/api/flutterwave-mock/[...path]">) {
  const bad = guard(req);
  if (bad) return bad;
  const { path } = await ctx.params;
  if (path.join("/") !== "v3/transactions/verify_by_reference") return new Response("Not found", { status: 404 });
  const reference = new URL(req.url).searchParams.get("tx_ref") ?? "";
  const tx = await mockTransaction(getDb(), reference);
  if (!tx) return Response.json({ status: "error", message: "No transaction was found for this id", data: null }, { status: 400 });
  return Response.json({
    status: "success",
    message: "Transaction fetched successfully",
    data: { id: tx.id, tx_ref: reference, status: tx.status, amount: tx.amount, currency: tx.currency, payment_type: "card", created_at: tx.createdAt },
  });
}
