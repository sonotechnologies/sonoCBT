import { getDb } from "@/lib/db";
import { mockTransaction } from "@/lib/billing/mock";
import { mockMode, secretKey } from "@/lib/billing/paystack";
import { appUrl } from "@/lib/pdf/assets";

/** Paystack's two API calls we use, faked for development (PAYSTACK_MOCK=1). Off otherwise. */
function guard(req: Request): Response | null {
  if (!mockMode()) return new Response("Not found", { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${secretKey()}`) return Response.json({ status: false, message: "Invalid key" }, { status: 401 });
  return null;
}

export async function POST(req: Request, ctx: RouteContext<"/api/paystack-mock/[...path]">) {
  const bad = guard(req);
  if (bad) return bad;
  const { path } = await ctx.params;
  if (path.join("/") !== "transaction/initialize") return new Response("Not found", { status: 404 });
  const b = (await req.json()) as { email: string; amount: number; reference: string; callback_url: string };
  const q = new URLSearchParams({ reference: b.reference, amount: String(b.amount), email: b.email, callback: b.callback_url });
  return Response.json({ status: true, message: "Authorization URL created", data: { authorization_url: `${appUrl()}/dev/paystack-checkout?${q}`, reference: b.reference } });
}

export async function GET(req: Request, ctx: RouteContext<"/api/paystack-mock/[...path]">) {
  const bad = guard(req);
  if (bad) return bad;
  const { path } = await ctx.params;
  if (path.length !== 3 || path[0] !== "transaction" || path[1] !== "verify") return new Response("Not found", { status: 404 });
  const reference = decodeURIComponent(path[2]);
  const tx = await mockTransaction(getDb(), reference);
  return Response.json({
    status: true,
    message: "Verification successful",
    data: { status: tx?.status ?? "abandoned", reference, amount: tx?.amount ?? 0, currency: tx?.currency ?? "NGN", id: tx?.id ?? 0, channel: "card", paid_at: tx?.paidAt ?? null },
  });
}
