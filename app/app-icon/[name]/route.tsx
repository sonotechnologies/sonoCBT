import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { AppIcon } from "@/components/brand/app-icon";

/**
 * The installed-app icons: /app-icon/192, /app-icon/512 and /app-icon/maskable
 * (full-bleed, the bubble kept inside the centre safe zone for Android's shapes).
 */
export async function GET(_: Request, { params }: RouteContext<"/app-icon/[name]">) {
  const { name } = await params;
  const size = name === "192" ? 192 : name === "512" || name === "maskable" ? 512 : 0;
  if (!size) notFound();
  return new ImageResponse(<AppIcon size={size} maskable={name === "maskable"} />, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400, immutable" },
  });
}
