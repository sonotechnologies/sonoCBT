import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { z } from "zod";
import { appUrl } from "@/lib/pdf/assets";
import { PinSheetDocument } from "@/lib/pdf/pin-sheet-doc";
import { attachment } from "@/lib/pdf/report-cards";
import { checkPinsForSheet } from "@/lib/results/pins";
import { ResultsError } from "@/lib/results/pipeline";
import { getTenantContext } from "@/lib/tenant/context";

const body = z.object({ batch: z.string().max(40), pins: z.array(z.object({ serial: z.string().max(40), pin: z.string().max(20) })).max(500) });

/**
 * Prints PIN cards. The PINs come from the page that just made them (only
 * hashes are stored), and each is checked against this school's records first.
 */
export async function POST(req: Request, ctx: RouteContext<"/s/[schoolSlug]/results/pins/sheet">) {
  const { schoolSlug } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return new Response("Signed out", { status: 401 });
  const form = await req.formData();
  const parsed = body.safeParse({ batch: form.get("batch"), pins: JSON.parse(String(form.get("pins") ?? "[]")) });
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  let sheet;
  try {
    sheet = await checkPinsForSheet(t.scope, t.actor, parsed.data.pins);
  } catch (e) {
    if (e instanceof ResultsError) return new Response(e.message, { status: 400 });
    throw e;
  }
  const url = `${appUrl().replace(/^https?:\/\//, "")}/results?school=${t.school.slug}`;
  const doc = createElement(PinSheetDocument, { school: t.school.name, termLabel: sheet.termLabel, url, pins: sheet.pins, brand: t.school.brandColor ?? "#14213D" });
  const pdf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachment(`Result PINs ${sheet.termLabel} ${parsed.data.batch}.pdf`),
      "Cache-Control": "private, no-store",
    },
  });
}
