/**
 * /robots.txt: the site's own, from the CMS (GET /api/v1/robots: written on
 * its Sitemap screen, or made from Settings › Search), or, from a CMS too old
 * to have it, everything open and where the sitemap is. Prerendered. A site
 * with its own public/robots.txt keeps that one (the integration doesn't add
 * this route then).
 */
import type { APIRoute } from "astro";
import { runtimeClient } from "./env.js";

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const sitemap = site ? new URL("/sitemap.xml", site).href : "/sitemap.xml";
  let text = `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`;
  try {
    const { data } = await runtimeClient().robots();
    if (data?.text?.trim()) text = data.text.endsWith("\n") ? data.text : `${data.text}\n`;
  } catch {
    // A CMS before 1.32.4 has no /api/v1/robots: the default above.
  }
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
