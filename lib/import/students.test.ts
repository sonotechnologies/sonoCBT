import { describe, expect, it } from "vitest";
import {
  canonicalClass,
  checkStudents,
  isImportable,
  matchClass,
  parseDate,
  parseGender,
  readStudentSheet,
  splitFullName,
  summarise,
  tidyName,
  type Arm,
} from "./students";

const arms: Arm[] = [
  { id: "j1a", name: "JSS1A" },
  { id: "j1b", name: "JSS1B" },
  { id: "j3a", name: "JSS3A" },
  { id: "j3b", name: "JSS3B" },
  { id: "s1sci", name: "SS1 Science" },
  { id: "s1art", name: "SS1 Art" },
  { id: "s2com", name: "SS2 Commercial" },
];

describe("names", () => {
  it("title-cases capitals only", () => {
    expect(tidyName("OKAFOR")).toBe("Okafor");
    expect(tidyName("  mcDonald ")).toBe("mcDonald");
    expect(tidyName("ADE-BELLO")).toBe("Ade-Bello");
  });

  it.each([
    ["OKAFOR Chiamaka Ngozi", { lastName: "Okafor", firstName: "Chiamaka", otherNames: "Ngozi" }],
    ["Okafor, Chiamaka Ngozi", { lastName: "Okafor", firstName: "Chiamaka", otherNames: "Ngozi" }],
    ["Chiamaka Ngozi Okafor", { lastName: "Okafor", firstName: "Chiamaka", otherNames: "Ngozi" }],
    ["BELLO ABDULRAHMAN", { lastName: "Bello", firstName: "Abdulrahman", otherNames: "" }],
    ["Tunde Bakare", { lastName: "Bakare", firstName: "Tunde", otherNames: "" }],
  ])("splits %s", (full, expected) => expect(splitFullName(full)).toEqual(expected));
});

describe("class matching", () => {
  it.each([
    ["J.S.S 3 B", "JSS3B"],
    ["js3b", "JSS3B"],
    ["SSS 2 Commercial", "SS2COMMERCIAL"],
    ["S1 Sci", "SS1SCI"],
  ])("canonical(%s) = %s", (a, b) => expect(canonicalClass(a)).toBe(b));

  it("accepts spacing and case differences silently", () => {
    expect(matchClass("jss 3b", arms)).toEqual({ kind: "exact", arm: arms[3] });
    expect(matchClass("ss1 science", arms)).toEqual({ kind: "exact", arm: arms[4] });
  });

  it("suggests for abbreviations", () => {
    expect(matchClass("JS3B", arms)).toEqual({ kind: "suggest", arm: arms[3] });
    expect(matchClass("SSS1 Sci", arms)).toEqual({ kind: "suggest", arm: arms[4] });
    expect(matchClass("SS2", arms)).toEqual({ kind: "suggest", arm: arms[6] });
  });

  it("asks which arm when a level has several", () => {
    expect(matchClass("JSS1", arms)).toMatchObject({ kind: "choose", options: [arms[0], arms[1]] });
  });

  it("reports unknown classes", () => {
    expect(matchClass("Primary 5", arms)).toEqual({ kind: "none" });
    expect(matchClass("JSS2A", arms)).toEqual({ kind: "none" });
  });
});

describe("fields", () => {
  it("reads genders", () => {
    expect(parseGender("F")).toBe("female");
    expect(parseGender("Boy")).toBe("male");
    expect(parseGender("")).toBe("");
    expect(parseGender("x")).toBeNull();
  });

  it("reads dates as DD/MM/YYYY first", () => {
    expect(parseDate("04/07/2012")).toBe("2012-07-04");
    expect(parseDate("2012-07-04")).toBe("2012-07-04");
    expect(parseDate("31/02/2012")).toBeNull();
    expect(parseDate("soon")).toBeNull();
    expect(parseDate("")).toBe("");
  });
});

describe("readStudentSheet", () => {
  it("maps common header spellings and skips blank rows", () => {
    const { rows, missingColumns } = readStudentSheet([
      ["S/N", "Student Name", "Adm. No", "Class", "Sex", "D.O.B", "Parent Phone"],
      [1, "OKAFOR Chiamaka", "GFA/2021/0147", "JSS3B", "F", "04/07/2012", "0803 412 7788"],
      [],
      [2, "Tunde Bakare", "GFA/2020/0098", "SS1", "M", "", ""],
    ]);
    expect(missingColumns).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      line: 2,
      firstName: "Chiamaka",
      lastName: "Okafor",
      admissionNo: "GFA/2021/0147",
      className: "JSS3B",
      gender: "F",
      guardianPhone: "0803 412 7788",
    });
    expect(rows[1].line).toBe(4);
  });

  it("lists missing required columns", () => {
    expect(readStudentSheet([["Name", "Class"]]).missingColumns).toEqual(["Admission number"]);
  });
});

describe("checkStudents", () => {
  const base = { otherNames: "", gender: "", dateOfBirth: "", guardianName: "", guardianPhone: "" };
  const rows = [
    { line: 2, firstName: "Chiamaka", lastName: "Okafor", admissionNo: "GFA/2021/0147", className: "JSS3B", ...base },
    { line: 3, firstName: "Oluwaseun", lastName: "Adeyemi", admissionNo: "GFA/2021/0152", className: "JS3B", ...base },
    { line: 4, firstName: "Halima", lastName: "Yusuf", admissionNo: "", className: "JSS1A", ...base },
    { line: 5, firstName: "Tunde", lastName: "Bakare", admissionNo: "gfa/2021/0147", className: "JSS3A", ...base },
    { line: 6, firstName: "Ngozi", lastName: "Eze", admissionNo: "GFA/2019/0001", className: "JSS3A", ...base },
    { line: 7, firstName: "Emeka", lastName: "Nwosu", admissionNo: "GFA/2021/0200", className: "JSS1", ...base },
  ];
  const checked = checkStudents(rows, { arms, existingAdmissionNos: new Set(["GFA/2019/0001"]) });

  it("accepts a clean row", () => {
    expect(checked[0].issues).toEqual([]);
    expect(checked[0].classArmId).toBe("j3b");
    expect(isImportable(checked[0])).toBe(true);
  });

  it("flags a close class with a suggestion, not importable until accepted", () => {
    expect(checked[1].issues[0]).toMatchObject({ level: "warning", message: 'Class "JS3B" — did you mean JSS3B?' });
    expect(isImportable(checked[1])).toBe(false);
    const accepted = checkStudents([{ ...rows[1], classArmId: "j3b" }], { arms, existingAdmissionNos: new Set() });
    expect(isImportable(accepted[0])).toBe(true);
  });

  it("blocks missing and duplicate admission numbers", () => {
    expect(checked[2].issues[0]).toMatchObject({ level: "error", message: "No admission number" });
    expect(checked[3].issues[0]).toMatchObject({ level: "error", message: "Duplicate of row 2" });
  });

  it("skips students already in the school", () => {
    expect(checked[4].issues[0]).toMatchObject({ level: "skip" });
    expect(isImportable(checked[4])).toBe(false);
  });

  it("asks which arm", () => {
    expect(checked[5].issues[0].message).toMatch(/which arm/);
  });

  it("summarises", () => {
    expect(summarise(checked)).toEqual({ total: 6, ready: 1, needsLook: 1, blocked: 3, skipped: 1 });
  });
});
