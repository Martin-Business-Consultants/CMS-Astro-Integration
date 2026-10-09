// A minimal site on LibrePublish CMS. CMS_BASE_URL and CMS_API_TOKEN come
// from .env (or the environment).
//
// SSR=1 builds it for Cloudflare Workers, rendering on demand: the
// integration then adds the purge webhook (/_cms/webhook) and the Cache-Tag
// middleware, and tells the CMS to purge instead of rebuilding.
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import cms from "@librepublish/astro";

const onDemand = process.env.SSR === "1";

export default defineConfig({
  // Prerender in Node, where the build reads the CMS (workerd doesn't read .env).
  ...(onDemand ? { adapter: cloudflare({ prerenderEnvironment: "node" }) } : {}),
  integrations: [
    cms(),
    // src/pages/live/ renders on demand when there's an adapter, and isn't built otherwise.
    {
      name: "example-live-routes",
      hooks: {
        "astro:route:setup": ({ route }) => {
          if (route.component.includes("src/pages/live/")) route.prerender = !onDemand;
        },
      },
    },
  ],
});
