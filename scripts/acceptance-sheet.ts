/**
 * Writes docs/acceptance/jss2b-3rd-term-2025-26.xlsx: the seed class's raw CA
 * and exam scores, with totals, grades, averages and positions as live Excel
 * formulas (SUM, AVERAGE, RANK — the same as RANK.EQ — and LOOKUP), next to the app's own figures and
 * a ✓/✗ check column. Open it in Excel to see the two agree.
 *
 *   npm run acceptance:sheet
 */
import { mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import writeXlsxFile from "write-excel-file/node";
import type { Actor } from "@/lib/auth/permissions";
import * as t from "@/lib/db/schema";
import { broadsheet, listComponents } from "@/lib/results/pipeline";
import { tenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedGreenfield } from "./seed";

/** Formulas are stored without the leading "="; RANK (same as RANK.EQ) needs no _xlfn prefix. */
const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

async function main() {
  process.env.RESULTS_TOKEN_SECRET ||= "acceptance-sheet";
  const db = await createTestDb();
  const { school } = await seedGreenfield(db);
  const scope = tenantScope(db, school.id);
  const adminUser = (await db.select().from(t.user).where(eq(t.user.email, "proprietor@greenfieldacademy.ng")))[0];
  const admin: Actor = { id: adminUser.id, roles: [{ role: "school_admin", schoolId: school.id }] };
  const termId = (await scope.findMany(t.term, eq(t.term.number, 3)))[0].id;
  const armId = (await scope.findFirst(t.classArm, eq(t.classArm.name, "JSS2B")))!.id;
  const [comps, entries, bs] = await Promise.all([listComponents(scope, termId), scope.findMany(t.scoreEntry, eq(t.scoreEntry.termId, termId)), broadsheet(scope, admin, termId, armId)]);

  const students = [...bs.students].sort((a, b) => a.name.localeCompare(b.name));
  // Subjects the class actually has scores in (JSS2B didn't take French that term).
  const subjects = bs.subjects.filter((s) => entries.some((e) => e.subjectId === s.id));
  const first = 3; // header rows: title, subject names, column names
  const last = first + students.length - 1;
  const value = (sid: string, subj: string, comp: string) => entries.find((e) => e.studentId === sid && e.subjectId === subj && e.componentId === comp)?.value ?? null;
  const gradeFormula = (cell: string) => `LOOKUP(${cell},{0,40,45,50,55,60,65,70,75},{"F9","E8","D7","C6","C5","C4","B3","B2","A1"})`;

  // Columns: Name | per subject: components…, Total, Grade, Pos | Total | Average | Position | App total | App average | App position | Check
  const perSubject = comps.length + 3;
  const totalCols = subjects.map((_, si) => col(1 + si * perSubject + comps.length));
  const after = 1 + subjects.length * perSubject;
  const [cTotal, cAvg, cPos, cAppTotal, cAppAvg, cAppPos] = [0, 1, 2, 3, 4, 5].map((k) => col(after + k));

  const bold = { fontWeight: "bold" as const };
  const title = [{ value: `Greenfield Academy · JSS2B · 3rd Term 2025/2026 — spreadsheet check (formulas) vs the app`, ...bold, span: after + 7 }];
  const row1 = [{ value: "" }, ...subjects.flatMap((s) => [{ value: s.name, ...bold, span: perSubject }, ...Array(perSubject - 1).fill(null)]), { value: "Class result (spreadsheet)", ...bold, span: 3 }, null, null, { value: "The app", ...bold, span: 3 }, null, null, { value: "" }];
  const row2 = [{ value: "Student", ...bold }, ...subjects.flatMap(() => [...comps.map((c) => ({ value: `${c.name} /${c.weight}`, ...bold })), { value: "Total", ...bold }, { value: "Grade", ...bold }, { value: "Pos", ...bold }]), ...["Total", "Average", "Position", "Total", "Average", "Position", "Agrees?"].map((v) => ({ value: v, ...bold }))];

  const body = students.map((st, ri) => {
    const r = first + ri + 1;
    const cells: unknown[] = [{ type: String, value: st.name }];
    subjects.forEach((s, si) => {
      const base = 1 + si * perSubject;
      comps.forEach((c) => {
        const v = value(st.id, s.id, c.id);
        cells.push(v === null ? null : { type: Number, value: v });
      });
      const range = `${col(base)}${r}:${col(base + comps.length - 1)}${r}`;
      const tot = `${col(base + comps.length)}${r}`;
      cells.push({ type: "Formula", value: `SUM(${range})` });
      cells.push({ type: "Formula", value: gradeFormula(tot) });
      cells.push({ type: "Formula", value: `RANK(${tot},$${col(base + comps.length)}$${first + 1}:$${col(base + comps.length)}$${last + 1},0)` });
    });
    cells.push({ type: "Formula", value: `SUM(${totalCols.map((c) => `${c}${r}`).join(",")})` });
    cells.push({ type: "Formula", value: `AVERAGE(${totalCols.map((c) => `${c}${r}`).join(",")})`, format: "0.0" });
    cells.push({ type: "Formula", value: `RANK(${cAvg}${r},$${cAvg}$${first + 1}:$${cAvg}$${last + 1},0)` });
    cells.push({ type: Number, value: st.total ?? 0 });
    cells.push({ type: Number, value: st.average ?? 0, format: "0.0" });
    cells.push({ type: Number, value: st.position ?? 0 });
    cells.push({ type: "Formula", value: `IF(AND(${cTotal}${r}=${cAppTotal}${r},ROUND(${cAvg}${r},1)=${cAppAvg}${r},${cPos}${r}=${cAppPos}${r}),"✓","✗")` });
    return cells;
  });

  const stat = (label: string, fn: string) => [
    { value: label, ...bold },
    ...subjects.flatMap((_, si) => {
      const c = col(1 + si * perSubject + comps.length);
      const f = fn === "AVERAGE" ? `ROUND(AVERAGE(${c}${first + 1}:${c}${last + 1}),1)` : `${fn}(${c}${first + 1}:${c}${last + 1})`;
      return [...comps.map(() => null), { type: "Formula", value: f }, null, null];
    }),
  ];

  await mkdir("docs/acceptance", { recursive: true });
  await writeXlsxFile([title, row1, row2, ...body, [], stat("Class average", "AVERAGE"), stat("Highest", "MAX"), stat("Lowest", "MIN")] as never, {
    sheet: "JSS2B 3rd term",
    stickyRowsCount: first,
    stickyColumnsCount: 1,
    columns: [{ width: 22 }],
  } as never).toFile("docs/acceptance/jss2b-3rd-term-2025-26.xlsx");
  console.info(`Wrote docs/acceptance/jss2b-3rd-term-2025-26.xlsx (${students.length} students, ${subjects.length} subjects).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
