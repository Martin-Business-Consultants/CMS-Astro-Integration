/**
 * The CMS gives site paths as it stores them: "/menu", never "/menu/". A site
 * built with Astro's `trailingSlash: "always"` serves "/menu/" and redirects
 * the bare form, so what the integration writes for it — sitemap.xml and
 * _redirects — uses the slashed form, the one the site answers with a 200.
 */
export type TrailingSlash = "always" | "never" | "ignore";

/**
 * A site path in the form the site serves it. "/" and files ("/feed.xml")
 * stay as they are, and so do absolute URLs on another host; a query or
 * fragment is kept.
 */
export function sitePath(path: string, trailingSlash: TrailingSlash | undefined): string {
  if (trailingSlash !== "always" && trailingSlash !== "never") return path;
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const [, pathname, rest] = path.match(/^([^?#]*)(.*)$/)!;
  if (pathname === "/" || /\.[a-z0-9]+$/i.test(pathname)) return path;
  const bare = pathname.replace(/\/+$/, "");
  return `${trailingSlash === "always" ? `${bare}/` : bare}${rest}`;
}

/** An absolute URL on the site (`site`), in the form it serves; other URLs as they are. */
export function siteUrl(url: string, site: string | URL | undefined, trailingSlash: TrailingSlash | undefined): string {
  const origin = site ? new URL(String(site)).origin : null;
  if (url.startsWith("/") && !url.startsWith("//")) {
    const path = sitePath(url, trailingSlash);
    return origin ? `${origin}${path}` : path;
  }
  if (!origin) return url;
  try {
    const absolute = new URL(url);
    if (absolute.origin !== origin) return url;
    return `${origin}${sitePath(`${absolute.pathname}${absolute.search}${absolute.hash}`, trailingSlash)}`;
  } catch {
    return url;
  }
}

/**
 * sitemap.xml with every <loc> and hreflang href absolute on the site and in
 * the form it serves. The CMS writes paths when Settings › General has no
 * site URL, and search engines only take absolute ones.
 */
export function shapeSitemap(xml: string, site: string | URL | undefined, trailingSlash: TrailingSlash | undefined): string {
  return xml
    .replace(/<loc>([^<]*)<\/loc>/g, (_, loc: string) => `<loc>${escape(siteUrl(unescape(loc), site, trailingSlash))}</loc>`)
    .replace(/(<xhtml:link\b[^>]*\bhref=")([^"]*)(")/g, (_, before: string, href: string, after: string) =>
      `${before}${escape(siteUrl(unescape(href), site, trailingSlash))}${after}`);
}

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescape(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}
