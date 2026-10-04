import { afterEach, describe, expect, it, vi } from "vitest";
import { simpleToItem } from "@/lib/import/simple";
import { assess } from "@/lib/import/items";
import { DEFAULT_MODELS, geminiProvider, parseModels } from "./gemini";
import { generateQuestions, readQuestionPhotos, suggestTags } from "./questions";

const reply = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } : { error: { message: "nope" } }), { status });

afterEach(() => vi.unstubAllGlobals());

describe("gemini provider", () => {
  it("sends images inline with a JSON schema and parses the reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reply({ questions: [{ number: 1, type: "objective", stem: "What is $2^3$?", options: ["6", "8", "9", "12"], answer: "B" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const qs = await readQuestionPhotos(geminiProvider("k", "gemini-test"), [{ mimeType: "image/jpeg", base64: "AAA" }], { subject: "Mathematics", classLevel: "JSS3" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/models/gemini-test:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "AAA" } });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    const item = simpleToItem(qs[0], [{ level: "amber", message: "Read from a photo." }]);
    expect(item.options[1].isCorrect).toBe(true);
    expect(assess(item).confidence).toBe("amber");
  });

  it("retries once on an unreadable reply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })))
      .mockResolvedValueOnce(reply({ questions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const qs = await generateQuestions(geminiProvider("k"), { subject: "Maths", classLevel: "JSS1", topic: "Fractions", count: 3, types: ["objective"], difficulty: "mixed" });
    expect(qs).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the free-tier limit clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({}, 429)));
    await expect(suggestTags(geminiProvider("k"), { subject: "Maths", classLevel: "JSS1", knownTopics: [] }, [{ id: "a", text: "1+1" }])).rejects.toThrow(/free-tier limit/);
  });

  it("backs off when a model is overloaded, then falls back to the next model", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({}, 503))
      .mockResolvedValueOnce(reply({}, 503))
      .mockResolvedValueOnce(reply({ tags: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const tags = await suggestTags(geminiProvider("k", "main-model, spare-model", { wait }), { subject: "Maths", classLevel: "JSS1", knownTopics: [] }, [{ id: "a", text: "1+1" }]);
    expect(tags).toEqual([]);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      expect.stringContaining("/main-model:"),
      expect.stringContaining("/main-model:"),
      expect.stringContaining("/spare-model:"),
    ]);
  });

  it("says Google is busy when every model is overloaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply({}, 503)));
    const ai = geminiProvider("k", ["a", "b"], { wait: async () => {} });
    await expect(suggestTags(ai, { subject: "Maths", classLevel: "JSS1", knownTopics: [] }, [{ id: "a", text: "1+1" }])).rejects.toMatchObject({ kind: "busy" });
  });

  it("moves to the next model when one is out of quota or retired", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({}, 429)).mockResolvedValueOnce(reply({}, 404)).mockResolvedValueOnce(reply({ tags: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await suggestTags(geminiProvider("k", "a,b,c"), { subject: "Maths", classLevel: "JSS1", knownTopics: [] }, [{ id: "a", text: "1+1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the default models when none are set", () => {
    expect(parseModels(undefined)).toEqual(DEFAULT_MODELS);
    expect(parseModels(" x , ,y ")).toEqual(["x", "y"]);
  });

  it("sends only question text when suggesting tags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ tags: [{ id: "a", topic: "Addition", difficulty: "easy" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const tags = await suggestTags(geminiProvider("k"), { subject: "Maths", classLevel: "JSS1", knownTopics: ["Fractions"] }, [{ id: "a", text: "What is 1+1?" }]);
    expect(tags).toEqual([{ id: "a", topic: "Addition", difficulty: "easy" }]);
    const text = JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text as string;
    expect(text).toContain("[a] What is 1+1?");
  });
});
