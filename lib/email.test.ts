import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSender, sendEmail } from "./email";

describe("parseSender", () => {
  it("splits name and address", () => {
    expect(parseSender("SonoCBT <me@gmail.com>")).toEqual({ name: "SonoCBT", email: "me@gmail.com" });
    expect(parseSender("me@gmail.com")).toEqual({ name: "SonoCBT", email: "me@gmail.com" });
  });
});

describe("sendEmail via Brevo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts to Brevo's transactional API", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "Greenfield via SonoCBT <me@gmail.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({ to: "t@school.ng", subject: "Hi", text: "Body" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: "Greenfield via SonoCBT", email: "me@gmail.com" },
      to: [{ email: "t@school.ng" }],
      subject: "Hi",
      textContent: "Body",
    });
  });

  it("throws when Brevo rejects, so invites show as not sent", async () => {
    vi.stubEnv("BREVO_API_KEY", "bad");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(sendEmail({ to: "t@school.ng", subject: "Hi", text: "Body" })).rejects.toThrow(/Brevo failed: 401/);
  });
});
