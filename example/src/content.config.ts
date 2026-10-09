import { defineCollection } from "astro:content";
import { cmsAssets, cmsEntries, cmsGlobals, cmsPages } from "@librepublish/astro/loaders";

export const collections = {
  pages: defineCollection({ loader: cmsPages() }),
  posts: defineCollection({ loader: cmsEntries("posts") }),
  globals: defineCollection({ loader: cmsGlobals() }),
  assets: defineCollection({ loader: cmsAssets() }),
};
