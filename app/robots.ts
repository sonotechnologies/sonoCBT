import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    // Schools' own pages, the platform console and private results stay out of search.
    rules: { userAgent: "*", allow: "/", disallow: ["/s/", "/platform", "/api/", "/dev/", "/results/view", "/verify/", "/invite", "/reset-password", "/suspended"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
