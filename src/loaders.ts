/**
 * Content collections from the CMS, for src/content.config.ts:
 *
 *   import { defineCollection } from "astro:content";
 *   import { cmsPages, cmsEntries, cmsGlobals, cmsAssets } from "@librepublish/astro/loaders";
 *
 *   export const collections = {
 *     pages: defineCollection({ loader: cmsPages() }),
 *     posts: defineCollection({ loader: cmsEntries("posts") }),
 *     globals: defineCollection({ loader: cmsGlobals() }),
 *     assets: defineCollection({ loader: cmsAssets() }),
 *   };
 *
 * They read GET /api/v1/content once per build between them, and only what
 * changed since the last build (the cursor is kept in each collection's
 * meta): an unchanged CMS costs one small request. Ids: a page's path ("" is
 * the home page), an entry's slug, a global's slug, an asset's id.
 */
import { buildClient } from "./build-connection.js";
import type { CmsAsset, CmsContent, ContentMeta, Envelope } from "./types.js";

// The smallest part of Astro's LoaderContext these loaders use, so the
// package needn't import Astro's internal types.
interface Store {
  set(entry: { id: string; data: Record<string, unknown>; digest?: string; body?: string }): boolean;
  delete(id: string): void;
  clear(): void;
}
interface LoaderContext {
  store: Store;
  meta: { get(key: string): string | undefined; set(key: string, value: string): void };
  parseData(props: { id: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  generateDigest(data: Record<string, unknown> | string): string;
  logger: { info(message: string): void };
}
export interface Loader { name: string; load(context: LoaderContext): Promise<void> }

type Snapshot = Envelope<CmsContent, ContentMeta>;

// One request per cursor, shared by the collections reading in the same
// build, and forgotten soon after so `astro dev` sees new content.
const pending = new Map<string, Promise<Snapshot>>();
function snapshot(since: string | undefined): Promise<Snapshot> {
  const key = since ?? "";
  let request = pending.get(key);
  if (!request) {
    request = buildClient().content(since);
    pending.set(key, request);
    setTimeout(() => pending.delete(key), 5_000).unref?.();
  }
  return request;
}

/** The cursor of the newest snapshot read, for the build report. */
export let lastCursor: string | undefined;

function contentLoader<T extends object>(
  name: string,
  pick: (content: CmsContent, included: Record<string, CmsAsset>) => [string, T][],
  removed: (content: CmsContent) => string[],
): Loader {
  return {
    name,
    async load({ store, meta, parseData, generateDigest, logger }) {
      const answer = await snapshot(meta.get("cursor"));
      if (answer.meta.full) store.clear();
      for (const id of removed(answer.data)) store.delete(id);

      const records = pick(answer.data, answer.included?.assets ?? {});
      for (const [id, record] of records) {
        const data = await parseData({ id, data: record as Record<string, unknown> });
        store.set({ id, data, digest: generateDigest(record as Record<string, unknown>) });
      }
      meta.set("cursor", answer.meta.cursor);
      lastCursor = answer.meta.cursor;
      logger.info(`${answer.meta.full ? "loaded" : "updated"} ${records.length} from the CMS`);
    },
  };
}

/** Every live page; `locale` keeps one language. */
export function cmsPages(options: { locale?: string } = {}): Loader {
  return contentLoader(
    "librepublish-pages",
    ({ pages }) => pages.filter((page) => !options.locale || page.locale === options.locale).map((page) => [page.path, page]),
    ({ removed }) => removed.pages.map((page) => page.path),
  );
}

/** A collection's live entries; `locale` keeps one language. */
export function cmsEntries(collection: string, options: { locale?: string } = {}): Loader {
  return contentLoader(
    `librepublish-entries-${collection}`,
    ({ entries }) => entries
      .filter((entry) => entry.collection === collection && (!options.locale || entry.locale === options.locale))
      .map((entry) => [entry.slug, entry]),
    ({ removed }) => removed.entries.filter((entry) => entry.collection === collection).map((entry) => entry.slug),
  );
}

/** The globals (nav, footer…), by slug. */
export function cmsGlobals(): Loader {
  return contentLoader(
    "librepublish-globals",
    ({ globals }) => globals.map((global) => [global.slug, global]),
    ({ removed }) => removed.globals.map((global) => global.slug),
  );
}

/** The assets the content points at, by id: absolute URLs, size, alt, renditions. */
export function cmsAssets(): Loader {
  return contentLoader(
    "librepublish-assets",
    (_content, assets) => Object.entries(assets),
    () => [],
  );
}
