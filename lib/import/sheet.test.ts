import { describe, expect, it } from "vitest";
import { docToText } from "@/lib/questions/rich";
import { assess } from "./items";
import { readQuestionSheet } from "./sheet";

describe("readQuestionSheet", () => {
  const { items, missingColumns } = readQuestionSheet([
    ["Question", "A", "B", "C", "D", "Answer", "Marks", "Topic", "Difficulty"],
    ["Which gas turns lime water milky?", "Oxygen", "Hydrogen", "Carbon(IV) oxide", "Nitrogen", "C", "1", "Gases", "Easy"],
    ["Evaluate $\\frac{1}{2} + \\frac{1}{4}$", "3/4", "1/6", "2/6", "1", "A", "", "Fractions", "Medium"],
    ["Which are prime?", "2", "4", "7", "9", "A, C", "2", "", ""],
    ["The sun rises in the east.", "", "", "", "", "True", "", "", ""],
    ["Water boils at ____ °C.", "", "", "", "", "100", "", "", ""],
    ["The removal of weeds is called ______.", "", "", "", "", "weeding / weed control", "", "", ""],
    ["Explain photosynthesis.", "", "", "", "", "Plants use light to make food from CO2 and water.", "5", "", "Hard"],
    ["", "", "", "", "", "", "", "", ""],
  ]);

  it("reads every filled row", () => {
    expect(missingColumns).toEqual([]);
    expect(items.map((i) => i.type)).toEqual(["mcq_single", "mcq_single", "mcq_multi", "true_false", "fill_blank", "fill_blank", "theory"]);
  });

  it("sets answers, marks, topic and difficulty", () => {
    expect(items[0].options[2].isCorrect).toBe(true);
    expect(items[0]).toMatchObject({ topicName: "Gases", difficulty: "easy", marks: 1 });
    expect(items[2].options.filter((o) => o.isCorrect)).toHaveLength(2);
    expect(items[3].trueFalse).toBe(true);
    expect(items[4].accepted).toEqual(["100"]);
    expect(items[5].accepted).toEqual(["weeding", "weed control"]);
    expect(items[6]).toMatchObject({ marks: 5, difficulty: "hard" });
    expect(docToText(items[6].markingGuide)).toMatch(/Plants use light/);
  });

  it("keeps $…$ maths as maths", () => {
    expect(docToText(items[1].stem)).toContain("$\\frac{1}{2} + \\frac{1}{4}$");
  });

  it("marks well-formed rows ready", () => {
    expect(items.every((i) => assess(i).confidence === "green")).toBe(true);
  });

  it("asks for a Question column", () => {
    expect(readQuestionSheet([["Stuff"], ["x"]]).missingColumns).toEqual(["Question"]);
  });
});
