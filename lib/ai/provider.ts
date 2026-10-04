/**
 * AI provider interface. Only question content, lesson notes and marking guides
 * are ever sent — never student names, admission numbers or scores.
 */
import type { z } from "zod";

export type AiPart = { text: string } | { image: { mimeType: string; base64: string } };

export type AiRequest<T> = {
  system: string;
  parts: AiPart[];
  /** JSON schema (OpenAPI subset) describing the reply. */
  schema: Record<string, unknown>;
  /** Validates the reply. */
  parse: z.ZodType<T>;
  temperature?: number;
};

export interface AiProvider {
  readonly name: string;
  generate<T>(req: AiRequest<T>): Promise<T>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "limit" | "busy" | "failed" | "blocked" | "plan" = "failed",
  ) {
    super(message);
  }
}
