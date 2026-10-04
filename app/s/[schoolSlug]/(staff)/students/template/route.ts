import writeXlsxFile from "write-excel-file/node";
import { TEMPLATE_HEADERS } from "@/lib/import/students";
import { armsOf } from "@/lib/school/setup";
import { getTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/auth/permissions";

/** Student import template, with two example rows using this school's own class names. */
export async function GET(req: Request, ctx: RouteContext<"/s/[schoolSlug]/students/template">) {
  const { schoolSlug } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !can(t.actor, "student.manage", { schoolId: t.school.id })) return new Response("Not found", { status: 404 });

  const arms = await armsOf(t.scope);
  const a = arms[0]?.name ?? "JSS1A";
  const b = arms.at(-1)?.name ?? "SS1 Science";
  const examples = [
    ["Okafor", "Chiamaka", "Ngozi", "ADM/2026/0001", a, "F", "04/07/2013", "Mrs. Ifeoma Okafor", "08034127788"],
    ["Bello", "Abdulrahman", "", "ADM/2026/0002", b, "M", "", "Alhaji Musa Bello", "08121234567"],
  ];

  const format = new URL(req.url).searchParams.get("format");
  if (format === "csv") {
    const csv = "﻿" + [TEMPLATE_HEADERS as readonly string[], ...examples].map((r) => r.join(",")).join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sonocbt-students-template.csv"',
      },
    });
  }

  const buffer = await writeXlsxFile(
    [
      TEMPLATE_HEADERS.map((h) => ({ value: h, fontWeight: "bold" as const })),
      ...examples.map((r) => r.map((v) => ({ value: v, type: String }))),
    ],
    { columns: TEMPLATE_HEADERS.map((h) => ({ width: Math.max(14, h.length + 4) })), stickyRowsCount: 1 },
  ).toBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sonocbt-students-template.xlsx"',
    },
  });
}
