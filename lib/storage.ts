import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/** Upload rules per kind of file. */
export const UPLOAD_RULES = {
  logo: { maxBytes: 1_000_000, types: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" } },
  // PDFs can only embed PNG and JPEG.
  signature: { maxBytes: 500_000, types: { "image/png": "png", "image/jpeg": "jpg" } },
  // No SVG in questions: they are shown inside the exam.
  question: { maxBytes: 2_000_000, types: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } },
} as const;

export class UploadError extends Error {}

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".uploads");

function r2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) return null;
  return {
    client: new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" }),
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`,
    publicUrl: R2_PUBLIC_URL.replace(/\/$/, ""),
  };
}

/**
 * Stores an uploaded file under `schools/<schoolId>/<kind>/…` and returns its public URL.
 * Uses Cloudflare R2 when configured; otherwise (development only) the local ./.uploads folder.
 */
export async function storeUpload(schoolId: string, kind: keyof typeof UPLOAD_RULES, file: File): Promise<string> {
  return storeBytes(schoolId, kind, new Uint8Array(await file.arrayBuffer()), file.type);
}

/** Same as storeUpload, for bytes that didn't come from a form (e.g. images inside a Word file). */
export async function storeBytes(schoolId: string, kind: keyof typeof UPLOAD_RULES, body: Uint8Array, contentType: string): Promise<string> {
  const rules = UPLOAD_RULES[kind];
  const ext = (rules.types as Record<string, string>)[contentType];
  if (!ext) throw new UploadError(`Use a ${Object.values(rules.types).map((t) => t.toUpperCase()).join(", ")} image.`);
  if (body.byteLength > rules.maxBytes) throw new UploadError(`That image is too large. Keep it under ${rules.maxBytes / 1_000_000} MB.`);

  const key = `schools/${schoolId}/${kind}/${randomUUID()}.${ext}`;

  const remote = r2();
  if (remote) {
    const res = await remote.client.fetch(`${remote.endpoint}/${key}`, {
      method: "PUT",
      body: new Blob([new Uint8Array(body)], { type: contentType }),
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
    });
    if (!res.ok) throw new UploadError(`Upload failed (${res.status}). Try again.`);
    return `${remote.publicUrl}/${key}`;
  }

  if (process.env.NODE_ENV === "production") throw new UploadError("File storage isn't configured.");
  const target = path.join(LOCAL_UPLOAD_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return `/files/${key}`;
}

// ─── Private files (exam snapshots) ─────────────────────────────────────────
// Never served publicly: staff read them through an authenticated route.
// Production needs a separate, private R2 bucket (R2_PRIVATE_BUCKET).

export const LOCAL_PRIVATE_DIR = path.join(process.cwd(), ".uploads-private");

function r2Private() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PRIVATE_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PRIVATE_BUCKET) return null;
  return {
    client: new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" }),
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_PRIVATE_BUCKET}`,
  };
}

/** Can this deployment keep private files? (Always in development; production needs R2_PRIVATE_BUCKET.) */
export function privateStorageReady(): boolean {
  return !!r2Private() || process.env.NODE_ENV !== "production";
}

const PRIVATE_KEY = /^schools\/[0-9a-f-]{36}\/snapshots\/[0-9a-f-]{36}\.jpg$/;

export async function storePrivate(schoolId: string, body: Uint8Array): Promise<string> {
  const key = `schools/${schoolId}/snapshots/${randomUUID()}.jpg`;
  const remote = r2Private();
  if (remote) {
    const res = await remote.client.fetch(`${remote.endpoint}/${key}`, {
      method: "PUT",
      body: new Blob([new Uint8Array(body)], { type: "image/jpeg" }),
      headers: { "Content-Type": "image/jpeg" },
    });
    if (!res.ok) throw new UploadError(`Upload failed (${res.status}).`);
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new UploadError("Private storage isn't configured.");
  const target = path.join(LOCAL_PRIVATE_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return key;
}

export async function readPrivate(key: string): Promise<Uint8Array | null> {
  if (!PRIVATE_KEY.test(key)) return null;
  const remote = r2Private();
  if (remote) {
    const res = await remote.client.fetch(`${remote.endpoint}/${key}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }
  try {
    return new Uint8Array(await readFile(path.join(LOCAL_PRIVATE_DIR, key)));
  } catch {
    return null;
  }
}

export async function deletePrivate(key: string): Promise<void> {
  if (!PRIVATE_KEY.test(key)) return;
  const remote = r2Private();
  if (remote) {
    await remote.client.fetch(`${remote.endpoint}/${key}`, { method: "DELETE" });
    return;
  }
  await rm(path.join(LOCAL_PRIVATE_DIR, key), { force: true });
}
