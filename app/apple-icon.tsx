import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/brand/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone and iPad (iOS rounds the corners itself). */
export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} />, size);
}
