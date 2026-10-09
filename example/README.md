# Example site

The smallest Astro site on LibrePublish CMS: every page and post, the nav,
SEO tags, a sitemap and the CMS's redirects. Block types render as their
JSON — a real site gives each a component.

```sh
cp .env.example .env    # CMS_BASE_URL and a service token
npm install
npm run dev
SSR=1 npm run build     # on demand, for Cloudflare Workers
```
