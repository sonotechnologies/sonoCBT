/** Exam slips and PIN sheets render as A4 PDFs; samples go to test-results/. */
import { mkdir, writeFile } from "node:fs/promises";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ExamPinSheetDocument, ExamSlipsDocument, type SlipClass } from "./exam-slips-doc";

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const info = { school: "Greenfield Academy", exam: "JSS3 Mock · Paper 1", when: "06/10/2026 · 09:30", signInUrl: "sonocbt.ng/s/greenfield-academy/login", brand: "#1B5E3A" };
const cls = (name: string, n: number): SlipClass => ({
  name,
  venue: "ICT Lab 2",
  slips: Array.from({ length: n }, (_, i) => ({ studentId: `${name}-${i}`, name: `Student ${i + 1} ${name}`, admissionNo: `GFA/2021/${String(150 + i).padStart(4, "0")}`, seat: String(i + 1).padStart(2, "0"), className: name, venue: "ICT Lab 2", pin: "4821 7730" })),
});
const render = (el: unknown) => renderToBuffer(el as Parameters<typeof renderToBuffer>[0]);

describe("exam slips and PIN sheets", () => {
  it("prints slips ten to a page, each class starting on a new page", async () => {
    const pdf = await render(createElement(ExamSlipsDocument, { info, classes: [cls("JSS3A", 23), cls("JSS3B", 10)] }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(pdf)).toBe(3 + 1);
    await mkdir("test-results", { recursive: true });
    await writeFile("test-results/exam-slips-sample.pdf", pdf);
  });

  it("puts each class's PIN sheet on its own pages, running over as needed", async () => {
    const pdf = await render(createElement(ExamPinSheetDocument, { info, classes: [cls("JSS3A", 60), cls("JSS3B", 12)] }));
    expect(pages(pdf)).toBeGreaterThanOrEqual(3);
    await writeFile("test-results/exam-pin-sheet-sample.pdf", pdf);
  });
});
