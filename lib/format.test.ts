import { describe, expect, it } from "vitest";
import { dayMonth, formatDate, formatDuration, formatTime, lagosDayKey, listAnd, num, termLabel } from "./format";

describe("format (Africa/Lagos)", () => {
  // 23:30 UTC on 26 Sep is 00:30 on 27 Sep in Lagos (UTC+1).
  const lateUtc = new Date("2026-09-26T23:30:00Z");

  it("uses Lagos time for dates and day keys", () => {
    expect(formatDate(lateUtc)).toBe("27/09/2026");
    expect(lagosDayKey(lateUtc)).toBe("2026-09-27");
    expect(formatTime(lateUtc)).toBe("00:30");
  });

  it("formats date blocks", () => {
    expect(dayMonth(new Date("2026-10-01T08:30:00Z"))).toEqual({ day: "01", month: "OCT" });
    expect(dayMonth(new Date("2026-09-29T08:30:00Z"))).toEqual({ day: "29", month: "SEP" });
  });

  it.each([
    [90, "1 hr 30 min"],
    [30, "30 min"],
    [120, "2 hr"],
  ])("duration %i → %s", (m, s) => expect(formatDuration(m)).toBe(s));

  it("labels terms", () => {
    expect(termLabel(3, "2025/2026")).toBe("3rd Term 2025/2026");
    expect(termLabel(1, "2026/2027", " · ")).toBe("1st Term · 2026/2027");
  });

  it("joins subject lists", () => {
    expect(listAnd(["English", "Mathematics", "Basic Science"])).toBe("English, Mathematics & Basic Science");
  });

  it("prints scores without trailing zeros", () => {
    expect(num(17)).toBe("17");
    expect(num(71.4)).toBe("71.4");
    expect(num(72.0)).toBe("72");
  });
});
