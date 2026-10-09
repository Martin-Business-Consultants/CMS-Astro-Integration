/**
 * The CMS's redirects (GET /api/v1/redirects.txt) as Cloudflare's _redirects.
 *
 * Cloudflare matches a source exactly, so "/old" and "/old/" are different
 * rules — and the URLs a site is moving away from were often linked with the
 * slash. Each plain path rule is written in both forms, so either reaches the
 * destination in one hop. Wildcards, placeholders, files and "/" are written
 * as the CMS has them. A destination on the site takes the site's own form
 * (`trailingSlash`), so it isn't a second redirect — unless it has a
 * placeholder, which is written as it is.
 */
import { sitePath, type TrailingSlash } from "./site-paths.js";

/** Cloudflare's limits on one _redirects file. */
export const LIMITS = { static: 2000, dynamic: 100 };

export interface RedirectRules {
  text: string;
  /** Rules matched literally, and rules with a splat or placeholder. */
  static: number;
  dynamic: number;
}

export function cloudflareRedirects(rules: string, trailingSlash?: TrailingSlash): RedirectRules {
  const lines: string[] = [];
  const seen = new Set<string>();
  let dynamicCount = 0;

  for (const line of rules.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [source, destination, ...rest] = trimmed.split(/\s+/);
    if (!source || !destination) continue;
    // A placeholder (":splat") can stand for a file or a slashed path, so
    // such a destination stays as the CMS wrote it.
    const to = [/[*:]/.test(destination.replace(/^https?:\/\//, "")) ? destination : sitePath(destination, trailingSlash), ...rest].join(" ");

    const dynamic = /[*:]/.test(source);
    const sources = dynamic || source === "/" || /\.[a-z0-9]+$/i.test(source)
      ? [source]
      : [source.replace(/\/+$/, ""), `${source.replace(/\/+$/, "")}/`];

    for (const from of sources) {
      // The first rule for a source is the one Cloudflare uses.
      if (seen.has(from)) continue;
      seen.add(from);
      lines.push(`${from} ${to}`);
      if (dynamic) dynamicCount++;
    }
  }

  return { text: lines.length ? `${lines.join("\n")}\n` : "", static: lines.length - dynamicCount, dynamic: dynamicCount };
}

/**
 * The pages a site built that a redirect takes visitors away from. Cloudflare
 * applies _redirects before it serves a file, so such a page is never seen —
 * usually a rule left over from before the page existed.
 */
export function shadowedPages(rules: string, built: Iterable<string>): string[] {
  const normalize = (path: string) => {
    const clean = `/${path.replace(/^\/+/, "")}`.replace(/\/index\.html$|\.html$/, "");
    return clean.length > 1 ? clean.replace(/\/+$/, "") : "/";
  };
  const pages = new Set([...built].map(normalize));
  const shadowed = new Set<string>();
  for (const line of rules.split("\n")) {
    const [source] = line.trim().split(/\s+/);
    if (!source || source.startsWith("#") || /[*:]/.test(source)) continue;
    if (pages.has(normalize(source))) shadowed.add(normalize(source));
  }
  return [...shadowed];
}
