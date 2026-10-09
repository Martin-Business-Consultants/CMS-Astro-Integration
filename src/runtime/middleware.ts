/**
 * For pages rendered on demand: `Astro.locals.cms` is a client for the
 * request, and the response says what content it was built from in a
 * Cache-Tag header (the CMS's tags: page:about, collection:posts, …), so a
 * publish purges exactly those pages (runtime/webhook.ts). Prerendered pages
 * are left alone.
 *
 * The tags come from every answer `Astro.locals.cms` gets, from each live
 * collection result a page hands to cacheHint() (@librepublish/astro/live),
 * and from Astro's own route cache when one is configured. The client is
 * made on first use, so a route that never reads the CMS (the purge webhook)
 * doesn't need the connection.
 */
import { defineMiddleware } from "astro:middleware";
import type { CmsClient } from "../client.js";
import { runtimeClient } from "./env.js";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();

  const tags = new Set<string>();
  let client: CmsClient | undefined;
  Object.defineProperty(context.locals, "cms", {
    configurable: true,
    enumerable: true,
    get: () => (client ??= runtimeClient({ tags })),
  });
  Object.defineProperty(context.locals, "cmsTags", { configurable: true, enumerable: false, value: tags });

  const response = await next();
  const cache = (context as { cache?: { enabled?: boolean; tags?: string[] } }).cache;
  if (cache?.enabled) cache.tags?.forEach((tag) => tags.add(tag));
  if (tags.size > 0 && !response.headers.has("Cache-Tag")) {
    try {
      response.headers.set("Cache-Tag", [...tags].join(","));
    } catch {
      // A response with immutable headers (a redirect, say) keeps them.
    }
  }
  return response;
});
