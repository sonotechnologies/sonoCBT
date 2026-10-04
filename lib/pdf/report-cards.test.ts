/**
 * Report cards from the demo seed: what goes on them, the verify codes, and
 * that the PDFs render (one page per student). A sample is written to
 * test-results/ for a look.
 */
import { mkdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as t from "@/lib/db/schema";
import { buildReportCards, getReportCard } from "@/lib/results/report-card";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedGreenfield } from "@/scripts/seed";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { PinSheetDocument } from "./pin-sheet-doc";
import { reportCardsPdf, reportCardsZip } from "./report-cards";

let scope: TenantScope;
let termId: string;
let nowTermId: string;
let armId: string;
let jss3b: string;
let chiamaka: string;

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

beforeAll(async () => {
  const db = await createTestDb();
  const { school } = await seedGreenfield(db);
  scope = tenantScope(db, school.id);
  const terms = await scope.findMany(t.term);
  const sessions = await scope.findMany(t.academicSession);
  const last = sessions.find((s) => s.name === "2025/2026")!.id;
  termId = terms.find((x) => x.sessionId === last && x.number === 3)!.id;
  nowTermId = terms.find((x) => x.isCurrent)!.id;
  const arms = await scope.findMany(t.classArm);
  armId = arms.find((a) => a.name === "JSS2B")!.id;
  jss3b = arms.find((a) => a.name === "JSS3B")!.id;
  chiamaka = (await scope.findFirst(t.student, eq(t.student.admissionNo, "GFA/2021/0147")))!.id;
});

describe("report cards", () => {
  it("has everything the report sheet prints, plus the session totals in 3rd term", async () => {
    const res = await getReportCard(scope, chiamaka, termId);
    expect(res.status).toBe("released");
    if (res.status !== "released") return;
    const c = res.card;
    expect(c.student.formalName).toBe("OKAFOR, Chiamaka");
    expect(c.school).toMatchObject({ name: "Greenfield Academy", principalName: "Mrs. Adunni Ogundipe" });
    expect(c.components.map((x) => `${x.name} ${x.weight}`)).toEqual(["CA 40", "Exam 60"]);
    expect(c.subjects).toHaveLength(8);
    expect(c).toMatchObject({ numberInClass: 38, daysOpened: 61, daysPresent: 58, formTeacherRemark: expect.stringMatching(/^Chiamaka is focused/), released: true });
    expect(c.affective.every((r) => r.value! >= 3 && r.value! <= 5)).toBe(true);
    expect(c.verifyCode).toMatch(/^GFA-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    // Cumulative: 1st and 2nd term totals are there and the annual average is their mean with this term.
    expect(c.cumulative).not.toBeNull();
    for (const [i, s] of c.cumulative!.subjects.entries()) {
      expect(s.totals[2]).toBe(c.subjects[i].total);
      expect(s.totals.every((x) => typeof x === "number")).toBe(true);
      expect(s.annualAverage).toBeCloseTo((s.totals as number[]).reduce((a, b) => a + b, 0) / 3, 1);
    }
  });

  it("keeps the same verify code each time a card is printed", async () => {
    const a = await getReportCard(scope, chiamaka, termId);
    const b = await getReportCard(scope, chiamaka, termId);
    expect(a.status === "released" && b.status === "released" && a.card.verifyCode === b.card.verifyCode).toBe(true);
    const all = await buildReportCards(scope, termId, armId);
    const codes = all.cards.map((c) => c.verifyCode);
    expect(new Set(codes).size).toBe(38);
  });

  it("shows nothing for an unreleased class unless it's a staff preview, which has no verify code", async () => {
    expect(await getReportCard(scope, chiamaka, nowTermId)).toMatchObject({ status: "not_released" });
    const preview = await buildReportCards(scope, nowTermId, jss3b, { allowUnreleased: true });
    expect(preview.released).toBe(false);
    expect(preview.cards.length).toBeGreaterThan(30);
    expect(preview.cards.every((c) => c.verifyCode === null && !c.released && c.cumulative === null)).toBe(true);
  });

  it("renders one PDF page per student, and a zip of single PDFs", async () => {
    const { cards } = await buildReportCards(scope, termId, armId);
    const one = await reportCardsPdf(cards.filter((c) => c.student.id === chiamaka), "Chiamaka");
    expect(one.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(one)).toBe(1);
    await mkdir("test-results", { recursive: true });
    await writeFile("test-results/report-card-sample.pdf", one);

    const three = cards.slice(0, 3);
    expect(pages(await reportCardsPdf(three, "JSS2B"))).toBe(3);
    const zip = await JSZip.loadAsync(await reportCardsZip(three, "3rd Term"));
    expect(Object.keys(zip.files)).toHaveLength(3);
    expect(Object.keys(zip.files).every((n) => /^GFA-2021-\d{4} .+\.pdf$/.test(n))).toBe(true);
  }, 60_000);

  it("prints PIN cards ten to a page", async () => {
    const pins = Array.from({ length: 12 }, (_, i) => ({ serial: `GFA-3T26-${String(149 + i).padStart(6, "0")}`, pin: "4821 7730 5519", maxUses: 5 }));
    const doc = createElement(PinSheetDocument, { school: "Greenfield Academy", termLabel: "3rd Term 2025/2026", url: "sonocbt.ng/results?school=greenfield-academy", pins, brand: "#1B5E3A" });
    const pdf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
    expect(pages(pdf)).toBe(2);
    await writeFile("test-results/pin-sheet-sample.pdf", pdf);
  });
});
