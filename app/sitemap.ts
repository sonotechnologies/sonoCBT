import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const pages: [string, number][] = [
    ["", 1],
    ["/features", 0.8],
    ["/pricing", 0.8],
    ["/demo", 0.9],
    ["/contact", 0.6],
    ["/signup", 0.6],
    ["/results", 0.5],
    ["/verify", 0.3],
  ];
  return pages.map(([path, priority]) => ({ url: `${base}${path}`, changeFrequency: "monthly", priority }));
}
