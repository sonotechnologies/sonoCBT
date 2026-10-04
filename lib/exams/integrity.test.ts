import { describe, expect, it } from "vitest";
import { clientIp, describeEvent, ipAllowed, monitorStatus, validNetwork } from "./integrity";

describe("network allow-list", () => {
  it("allows anywhere when there's no list", () => {
    expect(ipAllowed("1.2.3.4", [])).toBe(true);
    expect(ipAllowed(null, undefined)).toBe(true);
  });

  it("matches IPv4 ranges and exact addresses", () => {
    const lab = ["102.89.4.0/24", "41.58.10.7"];
    expect(ipAllowed("102.89.4.200", lab)).toBe(true);
    expect(ipAllowed("102.89.5.1", lab)).toBe(false);
    expect(ipAllowed("41.58.10.7", lab)).toBe(true);
    expect(ipAllowed("::ffff:102.89.4.9", lab)).toBe(true);
    expect(ipAllowed(null, lab)).toBe(false);
    expect(ipAllowed("10.1.2.3", ["0.0.0.0/0"])).toBe(true);
  });

  it("validates what staff type", () => {
    expect(validNetwork("10.0.0.0/8")).toBe(true);
    expect(validNetwork("300.1.1.1")).toBe(false);
    expect(validNetwork("10.0.0.0/40")).toBe(false);
    expect(validNetwork("2001:db8::1")).toBe(true);
  });

  it("reads the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "102.89.4.9, 10.0.0.1" }))).toBe("102.89.4.9");
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("monitor", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const seen = (s: number) => new Date(now.getTime() - s * 1000);

  it("sorts students into the design's states", () => {
    expect(monitorStatus(null, now)).toBe("notstarted");
    expect(monitorStatus({ status: "in_progress", lastSeenAt: seen(10), integrityFlags: 0 }, now)).toBe("progress");
    expect(monitorStatus({ status: "in_progress", lastSeenAt: seen(10), integrityFlags: 2 }, now)).toBe("flagged");
    expect(monitorStatus({ status: "in_progress", lastSeenAt: seen(70), integrityFlags: 2 }, now)).toBe("offline");
    expect(monitorStatus({ status: "auto_submitted", lastSeenAt: seen(500), integrityFlags: 3 }, now)).toBe("submitted");
  });

  it("describes events in plain words", () => {
    expect(describeEvent("tab_hidden", { awayMs: 8200 })).toMatchObject({ title: "Left the exam window", detail: "for 8 s", tone: "warn" });
    expect(describeEvent("auto_submitted", { reason: "integrity", leaves: 3 }).detail).toBe("after 3 tab switches");
    expect(describeEvent("extra_time", { minutes: 5, by: "Mrs. Adebayo" }).title).toBe("Added 5 minutes");
  });
});
