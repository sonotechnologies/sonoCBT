import { AiError, type AiProvider, type AiRequest } from "./provider";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

type Options = { wait?: (ms: number) => Promise<void> };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "a, b" → ["a", "b"]. Empty → the defaults. */
export function parseModels(value: string | string[] | undefined): string[] {
  const list = (Array.isArray(value) ? value : (value ?? "").split(",")).map((m) => m.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

/**
 * Google Gemini (free tier works). Structured JSON output, validated with Zod.
 * If a model is overloaded (503) or out of free quota (429), it backs off and
 * then tries the next model in the list; one retry on an unreadable reply.
 */
export function geminiProvider(apiKey: string, models?: string | string[], opts: Options = {}): AiProvider {
  const list = parseModels(models);
  const wait = opts.wait ?? sleep;
  return {
    name: `gemini:${list[0]}`,
    async generate<T>(req: AiRequest<T>): Promise<T> {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          {
            role: "user",
            parts: req.parts.map((p) => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.image.mimeType, data: p.image.base64 } })),
          },
        ],
        generationConfig: { responseMimeType: "application/json", responseSchema: req.schema, temperature: req.temperature ?? 0.2 },
      });

      let busy = false;
      let limited = false;
      let lastError = "The AI reply couldn't be read.";
      for (const model of list) {
        let badReplies = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body,
          });
          const json = (await res.json().catch(() => ({}))) as GeminiResponse;
          if (res.status === 429) {
            limited = true;
            break; // quota is per model: try the next one
          }
          if (res.status === 404) break; // model retired for this key
          if (res.status === 400 || res.status === 403) {
            throw new AiError(`The AI service refused the request: ${json.error?.message ?? res.status}`, "failed");
          }
          if (res.status >= 500) {
            busy = true;
            if (attempt === 0) await wait(1500);
            continue;
          }
          if (!res.ok) {
            lastError = `The AI service had a problem (${res.status}).`;
            break;
          }
          if (json.promptFeedback?.blockReason) throw new AiError("The AI declined to read this. Try clearer pages.", "blocked");
          const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          try {
            const parsed = req.parse.safeParse(JSON.parse(text));
            if (parsed.success) return parsed.data;
            lastError = "The AI reply was missing some fields.";
          } catch {
            lastError = "The AI reply wasn't valid JSON.";
          }
          if (++badReplies >= 2) break;
        }
      }
      if (limited) throw new AiError("The AI is busy (free-tier limit reached). Try again in a minute.", "limit");
      if (busy) throw new AiError("Google's AI is very busy right now. Nothing was lost. Try again in a few minutes.", "busy");
      throw new AiError(lastError);
    },
  };
}
