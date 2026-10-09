/**
 * Live collections, for pages rendered on demand that should show a publish
 * at once (src/live.config.ts):
 *
 *   import { defineLiveCollection } from "astro:content";
 *   import { cmsLivePages, cmsLiveEntries } from "@librepublish/astro/live";
 *
 *   export const collections = {
 *     livePages: defineLiveCollection({ loader: cmsLivePages() }),
 *     livePosts: defineLiveCollection({ loader: cmsLiveEntries("posts") }),
 *   };
 *
 * Each answer carries the CMS's cache tags as its cacheHint. Hand it to
 * cacheHint() so the response says what it was built from (Cache-Tag) and a
 * publish purges it:
 *
 *   const { entry, cacheHint: hint } = await getLiveEntry("livePages", "about");
 *   cacheHint(Astro, hint);
 */
import { runtimeClient } from "./runtime/env.js";
import { CmsError } from "./client.js";
import type { CmsEntry, CmsPage } from "./types.js";

type Hint = { tags?: string[]; lastModified?: Date };
type LiveEntry<T> = { id: string; data: T; cacheHint?: Hint };

const hint = (tags: Iterable<string>, updated?: string): Hint => ({
  tags: [...tags],
  lastModified: updated ? new Date(updated) : undefined,
});

/**
 * Adds a live collection result's cache tags to the response's Cache-Tag
 * (through the middleware the integration adds), and to Astro's route cache
 * when one is configured. Pass the result's `cacheHint`, an entry, or both.
 */
export function cacheHint(
  astro: { locals: object; cache?: { enabled?: boolean; set(hint: Hint): void } },
  ...hints: Array<Hint | { cacheHint?: Hint } | null | undefined>
): void {
  const tags = (astro.locals as { cmsTags?: Set<string> }).cmsTags;
  for (const given of hints) {
    const hint = given && "cacheHint" in given ? given.cacheHint : (given as Hint | null | undefined);
    if (!hint) continue;
    hint.tags?.forEach((tag) => tags?.add(tag));
    if (astro.cache?.enabled) astro.cache.set(hint);
  }
}

// A missing entry is "not found" (undefined); anything else, a missing
// collection included, is an error the page can show.
async function attempt<T>(load: () => Promise<T>, missing: "empty" | "error" = "empty"): Promise<T | { error: Error }> {
  try {
    return await load();
  } catch (error) {
    if (missing === "empty" && error instanceof CmsError && error.status === 404) return undefined as T;
    return { error: error as Error };
  }
}

export function cmsLivePages() {
  return {
    name: "librepublish-live-pages",
    loadCollection: ({ filter }: { filter?: { locale?: string } }) => attempt(async () => {
      const cms = runtimeClient();
      const { data } = await cms.pages({ locale: filter?.locale });
      return {
        entries: data.map((page): LiveEntry<CmsPage> => ({ id: page.path, data: page, cacheHint: hint([`page:${page.path}`], page.updated_at) })),
        cacheHint: hint(cms.tags),
      };
    }, "error"),
    loadEntry: ({ filter }: { filter: { id: string } }) => attempt(async () => {
      const cms = runtimeClient();
      const { data } = await cms.page(filter.id);
      return { id: data.path, data, cacheHint: hint(cms.tags, data.updated_at) } satisfies LiveEntry<CmsPage>;
    }),
  };
}

export function cmsLiveEntries(collection: string) {
  return {
    name: `librepublish-live-entries-${collection}`,
    loadCollection: ({ filter }: { filter?: { locale?: string } }) => attempt(async () => {
      const cms = runtimeClient();
      const { data } = await cms.entries(collection, { locale: filter?.locale });
      return {
        entries: data.map((entry): LiveEntry<CmsEntry> => ({
          id: entry.slug, data: entry, cacheHint: hint([`entry:${collection}/${entry.slug}`], entry.updated_at),
        })),
        cacheHint: hint(cms.tags),
      };
    }, "error"),
    loadEntry: ({ filter }: { filter: { id: string } }) => attempt(async () => {
      const cms = runtimeClient();
      const { data } = await cms.entry(collection, filter.id);
      return { id: data.slug, data, cacheHint: hint(cms.tags, data.updated_at) } satisfies LiveEntry<CmsEntry>;
    }),
  };
}
