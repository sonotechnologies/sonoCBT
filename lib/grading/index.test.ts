import { describe, expect, it } from "vitest";
import { computeClassResults, gradeFor, ordinal, rank, type ComponentScore } from "./index";

describe("rank", () => {
  it("gives tied values the same position and skips the next (1st, 2nd, 2nd, 4th)", () => {
    const r = rank([
      { key: "a", value: 90 },
      { key: "b", value: 80 },
      { key: "c", value: 80 },
      { key: "d", value: 70 },
    ]);
    expect([...["a", "b", "c", "d"].map((k) => r.get(k))]).toEqual([1, 2, 2, 4]);
  });

  it("handles everyone tied", () => {
    const r = rank([
      { key: "a", value: 50 },
      { key: "b", value: 50 },
    ]);
    expect([r.get("a"), r.get("b")]).toEqual([1, 1]);
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [6, "6th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [101, "101st"],
    [111, "111th"],
  ])("%i → %s", (n, s) => expect(ordinal(n)).toBe(s));
});

describe("gradeFor (WAEC default)", () => {
  it.each([
    [100, "A1"],
    [75, "A1"],
    [74.5, "B2"],
    [72, "B2"],
    [62, "C4"],
    [58, "C5"],
    [50, "C6"],
    [45, "D7"],
    [40, "E8"],
    [39.99, "F9"],
    [0, "F9"],
  ])("%d → %s", (score, grade) => expect(gradeFor(score)?.grade).toBe(grade));
});

describe("computeClassResults", () => {
  // Hand-computed: CA (40) + Exam (60), two subjects, four students.
  //            Maths          English        Total  Avg   Pos
  // ada     30+50 = 80     20+40 = 60        140   70.0   1st
  // bola    25+45 = 70     25+45 = 70        140   70.0   1st (tie)
  // chidi   20+40 = 60     30+50 = 80        140   70.0   1st (tie)
  // dayo    10+30 = 40     15+35 = 50         90   45.0   4th
  const s = (studentId: string, subjectId: string, ca: number, ex: number): ComponentScore[] => [
    { studentId, subjectId, componentId: "ca", value: ca },
    { studentId, subjectId, componentId: "exam", value: ex },
  ];
  const scores = [
    ...s("ada", "maths", 30, 50),
    ...s("ada", "eng", 20, 40),
    ...s("bola", "maths", 25, 45),
    ...s("bola", "eng", 25, 45),
    ...s("chidi", "maths", 20, 40),
    ...s("chidi", "eng", 30, 50),
    ...s("dayo", "maths", 10, 30),
    ...s("dayo", "eng", 15, 35),
  ];
  const res = computeClassResults(scores);
  const get = (id: string) => res.students.get(id)!;
  const subj = (id: string, subjectId: string) => get(id).subjects.find((x) => x.subjectId === subjectId)!;

  it("counts the class", () => expect(res.numberInClass).toBe(4));

  it("totals and averages per student", () => {
    expect(get("ada").total).toBe(140);
    expect(get("ada").average).toBe(70);
    expect(get("dayo").average).toBe(45);
  });

  it("ranks class positions with ties", () => {
    expect(["ada", "bola", "chidi", "dayo"].map((id) => get(id).position)).toEqual([1, 1, 1, 4]);
  });

  it("computes subject positions, class average, highest and lowest", () => {
    expect(subj("ada", "maths")).toMatchObject({ total: 80, position: 1, grade: "A1", highest: 80, lowest: 40 });
    expect(subj("bola", "maths")).toMatchObject({ total: 70, position: 2, grade: "B2" });
    expect(subj("dayo", "maths")).toMatchObject({ total: 40, position: 4, grade: "E8" });
    // (80 + 70 + 60 + 40) / 4 = 62.5
    expect(subj("ada", "maths").classAverage).toBe(62.5);
    expect(subj("chidi", "eng")).toMatchObject({ total: 80, position: 1 });
  });

  it("keeps component scores for the report card", () => {
    expect(subj("ada", "maths").components).toEqual({ ca: 30, exam: 50 });
  });
});
