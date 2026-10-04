import { describe, expect, it } from "vitest";
import { evaluate, formatResult } from "./calc";

describe("calculator", () => {
  it.each([
    ["2 + 3 × 4", 14],
    ["(2 + 3) × 4", 20],
    ["10 ÷ 4", 2.5],
    ["2^3^2", 512],
    ["−3 + 5", 2],
    ["50%", 0.5],
    ["√16 + 1", 5],
    ["sin 30", 0.5],
    ["cos(60)", 0.5],
    ["log 1000", 3],
    ["ln e", 1],
    ["2π", 2 * Math.PI],
    ["3(4 + 1)", 15],
    ["0.1 + 0.2", 0.3],
    ["51750 − 45000", 6750],
    ["(51750 − 45000) ÷ 45000 × 100", 15],
  ])("%s = %s", (src, want) => {
    expect(evaluate(src)).toBeCloseTo(want, 9);
  });

  it.each(["", "2 +", "(2", "2 ) 3", "abc", "1 ÷ 0", "√-1", "alert(1)"])("rejects %j", (src) => {
    expect(evaluate(src)).toBeNull();
  });

  it("formats results for a small display", () => {
    expect(formatResult(2 / 3)).toBe("0.6666666667");
    expect(formatResult(15)).toBe("15");
    expect(formatResult(1e15)).toBe("1e+15");
  });
});
