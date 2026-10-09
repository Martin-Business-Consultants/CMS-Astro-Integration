/**
 * /sitemap.xml, from the CMS (GET /api/v1/sitemap): every URL it lists,
 * absolute on the site, with lastmod and hreflang alternates. Prerendered.
 */
import type { APIRoute } from "astro";
import { runtimeClient } from "./env.js";

export const prerender = true;

export const GET: APIRoute = async () => {
  const { data } = await runtimeClient().sitemap();
  const urls = data.map((url) => [
    "  <url>",
    `    <loc>${escape(url.url)}</loc>`,
    url.lastmod ? `    <lastmod>${escape(url.lastmod)}</lastmod>` : null,
    `    <changefreq>${escape(url.changefreq)}</changefreq>`,
    `    <priority>${url.priority}</priority>`,
    ...url.alternates.map((alt) => `    <xhtml:link rel="alternate" hreflang="${escape(alt.locale)}" href="${escape(alt.url)}"/>`),
    "  </url>",
  ].filter(Boolean).join("\n"));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
