import { describe, expect, it } from "vitest";
import { WAEC_BANDS } from "@/lib/grading";
import { bandProblems, cellIssue, componentProblems, parsePaste, scaleScore } from "./rules";

describe("components", () => {
  it("must add up to 100 with distinct names", () => {
    expect(componentProblems([{ name: "CA1", weight: 10 }, { name: "CA2", weight: 10 }, { name: "Assignment", weight: 10 }, { name: "Project", weight: 10 }, { name: "Exam", weight: 60 }])).toBeNull();
    expect(componentProblems([{ name: "CA", weight: 40 }, { name: "Exam", weight: 50 }])).toMatch(/add up to 90/);
    expect(componentProblems([{ name: "CA", weight: 40 }, { name: "ca", weight: 60 }])).toMatch(/same name/);
    expect(componentProblems([{ name: "CA", weight: 40.5 }, { name: "Exam", weight: 59.5 }])).toMatch(/whole number/);
    expect(componentProblems([])).toMatch(/at least one/);
  });
});

describe("grading scale", () => {
  it("accepts the WAEC scale", () => {
    expect(bandProblems(WAEC_BANDS)).toBeNull();
  });

  it("catches gaps, overlaps and missing ends", () => {
    const gap = WAEC_BANDS.map((b) => (b.grade === "B2" ? { ...b, min: 71 } : b));
    expect(bandProblems(gap)).toMatch(/gap between B3/);
    const overlap = WAEC_BANDS.map((b) => (b.grade === "B2" ? { ...b, max: 76 } : b));
    expect(bandProblems(overlap)).toMatch(/overlap/);
    expect(bandProblems(WAEC_BANDS.filter((b) => b.grade !== "A1"))).toMatch(/top band/);
    expect(bandProblems(WAEC_BANDS.map((b) => (b.grade === "B3" ? { ...b, grade: "A1" } : b)))).toMatch(/same grade/);
  });
});

describe("grid cells", () => {
  it.each([
    ["", 10, "missing"],
    ["  ", 10, "missing"],
    ["7", 10, null],
    ["7.5", 10, null],
    ["10", 10, null],
    ["14", 10, "too_high"],
    ["abs", 10, "not_a_number"],
    ["-3", 10, "not_a_number"],
  ])("%j out of %d → %s", (raw, max, want) => {
    expect(cellIssue(raw as string, max as number)).toBe(want);
  });
});

describe("pasting from Excel", () => {
  it("reads tab-separated rows, and CSV", () => {
    expect(parsePaste("7\t8\t9\r\n6\t\t10\r\n")).toEqual([
      ["7", "8", "9"],
      ["6", "", "10"],
    ]);
    expect(parsePaste('7,"8",9')).toEqual([["7", "8", "9"]]);
  });
});

describe("scaling exam marks", () => {
  it("scales to the component and never past it", () => {
    expect(scaleScore(15, 22, 60)).toBe(40.9);
    expect(scaleScore(22, 22, 60)).toBe(60);
    expect(scaleScore(25, 22, 60)).toBe(60);
    expect(scaleScore(0, 0, 60)).toBe(0);
  });
});
