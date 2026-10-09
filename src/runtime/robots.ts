/**
 * /robots.txt: everything open to crawlers, and where the sitemap is.
 * Prerendered. A site with its own public/robots.txt keeps that one (the
 * integration doesn't add this route then).
 */
import type { APIRoute } from "astro";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? new URL("/sitemap.xml", site).href : "/sitemap.xml";
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
