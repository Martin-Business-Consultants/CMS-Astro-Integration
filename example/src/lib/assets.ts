import { getCollection } from "astro:content";
import type { CmsAsset } from "@librepublish/astro/client";

/** Every asset the content points at, by id (empty without the CMS's media library). */
export async function assetsById(): Promise<Record<string, CmsAsset>> {
  return Object.fromEntries((await getCollection("assets")).map((asset) => [asset.id, asset.data as unknown as CmsAsset]));
}
