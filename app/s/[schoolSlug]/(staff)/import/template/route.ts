import writeXlsxFile from "write-excel-file/node";
import { can } from "@/lib/auth/permissions";
import { SHEET_TEMPLATE_HEADERS } from "@/lib/import/sheet";
import { getTenantContext } from "@/lib/tenant/context";

const EXAMPLES = [
  ["Which gas turns lime water milky?", "Oxygen", "Hydrogen", "Carbon(IV) oxide", "Nitrogen", "", "C", "1", "Gases", "Easy", ""],
  ["Evaluate $\\frac{3}{4} + \\frac{1}{6}$", "$\\frac{4}{10}$", "$\\frac{11}{12}$", "$\\frac{2}{5}$", "$\\frac{5}{6}$", "", "B", "1", "Fractions", "Medium", ""],
  ["Every square is a rectangle.", "", "", "", "", "", "True", "1", "Shapes", "Easy", ""],
  ["The removal of weeds from a farm is called ______.", "", "", "", "", "", "weeding", "1", "Farm practices", "Easy", ""],
  ["Explain two causes of soil erosion.", "", "", "", "", "", "Deforestation; overgrazing; running water (2 marks each)", "4", "Soil", "Medium", "Theory"],
];

/** Question-list template for Excel/CSV import. */
export async function GET(req: Request, ctx: RouteContext<"/s/[schoolSlug]/import/template">) {
  const { schoolSlug } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !can(t.actor, "question.create", { schoolId: t.school.id })) return new Response("Not found", { status: 404 });

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = "﻿" + [SHEET_TEMPLATE_HEADERS as readonly string[], ...EXAMPLES].map((r) => r.map(esc).join(",")).join("\r\n");
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sonocbt-questions-template.csv"' },
    });
  }
  const buffer = await writeXlsxFile(
    [SHEET_TEMPLATE_HEADERS.map((h) => ({ value: h, fontWeight: "bold" as const })), ...EXAMPLES.map((r) => r.map((v) => ({ value: v, type: String })))],
    { columns: SHEET_TEMPLATE_HEADERS.map((h) => ({ width: h === "Question" ? 50 : h.length <= 1 ? 16 : 14 })), stickyRowsCount: 1 },
  ).toBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sonocbt-questions-template.xlsx"',
    },
  });
}
