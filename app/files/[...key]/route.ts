import { readFile } from "node:fs/promises";
import path from "node:path";
import { LOCAL_UPLOAD_DIR } from "@/lib/storage";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

/** Development-only file server for ./.uploads (production uses R2's public URL). */
export async function GET(_: Request, ctx: RouteContext<"/files/[...key]">) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { key } = await ctx.params;
  const target = path.resolve(LOCAL_UPLOAD_DIR, ...key);
  if (!target.startsWith(LOCAL_UPLOAD_DIR + path.sep)) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(target);
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[path.extname(target).slice(1)] ?? "application/octet-stream",
        // SVGs can carry script; never let one run on our origin.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
