import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { LOCAL_UPLOAD_DIR } from "@/lib/storage";

/** An image react-pdf can embed (PNG or JPEG only), as a data URL. */
export type PdfImage = string;

function kind(b: Uint8Array): "png" | "jpeg" | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}

const cache = new Map<string, Promise<PdfImage | null>>();

/**
 * Loads an uploaded image (logo, photo, signature) for a PDF. SVG/WebP and
 * anything unreachable come back null, and the PDF shows a placeholder.
 */
export function loadImage(url: string | null | undefined): Promise<PdfImage | null> {
  if (!url) return Promise.resolve(null);
  let p = cache.get(url);
  if (!p) {
    p = fetchBytes(url)
      .then((b) => {
        const k = b && kind(b);
        return k ? `data:image/${k};base64,${Buffer.from(b).toString("base64")}` : null;
      })
      .catch(() => null);
    cache.set(url, p);
    // Keep the cache small; a class batch reuses the logo and signature.
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  if (url.startsWith("/files/")) {
    const rel = url.slice("/files/".length);
    const target = path.join(LOCAL_UPLOAD_DIR, rel);
    if (!target.startsWith(LOCAL_UPLOAD_DIR)) return null;
    return new Uint8Array(await readFile(target));
  }
  if (!/^https:\/\//.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength <= 3_000_000 ? buf : null;
}

export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 0, errorCorrectionLevel: "M", width: 240 });
}

/** The site's public address, for verify links. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}
