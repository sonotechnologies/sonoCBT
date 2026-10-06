import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/** Lets phones and computers install SonoCBT as an app (home-screen icon, opens without the browser bar). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/start",
    name: "SonoCBT",
    short_name: "SonoCBT",
    description: SITE.description,
    // /start sends each person to their own home: dashboard, student page or sign in.
    start_url: "/start",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#FAF8F3",
    theme_color: "#14213D",
    lang: "en-NG",
    categories: ["education", "productivity"],
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Check a result", short_name: "Results", url: "/results", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
      { name: "Staff sign in", short_name: "Staff", url: "/login", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
    ],
  };
}
