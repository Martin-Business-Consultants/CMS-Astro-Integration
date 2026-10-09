# LibrePublish CMS for Astro

`@librepublish/astro` is the whole Astro integration for
[LibrePublish CMS](https://github.com/Martin-Business-Consultants/cmsv2) (cmsv2),
in one package. It covers the core content API, the CMS's two default
plugins, **Forms** and **Media**, and **Commerce** when it's switched on:

- **Content.** Content loaders that only fetch what changed, live collections
  for on-demand pages, and TypeScript types generated from the CMS's schema.
- **Rendering.** `<Blocks>`, `<Image>` (Media renditions as a srcset, with the
  focal point), `<Seo>`, `linkHref` and `recordPath`.
- **Forms.** `<Form>` posts straight to the CMS, with a honeypot and
  Turnstile or reCAPTCHA. Form emails are built in the site's design and sent
  to the CMS at build time.
- **Commerce.** `<QuoteRequest>` sends "Request a quote" straight to the CMS's
  quote inbox, with the items as the visitor saw them.
- **Site files.** `/sitemap.xml`, `/robots.txt` and Cloudflare `_redirects`,
  all from the CMS.
- **Publishing.** A static site is rebuilt when content is published. An
  on-demand site gets a signed cache purge at `/_cms/webhook` instead, and
  every response carries a `Cache-Tag`.
- **Build checks.** Site health is checked on every build, `AGENTS.md` is
  kept up to date, and each build reports to the CMS (Developers screen).

It reads the CMS's delivery API (`/api/v1`). That API only serves live
content, always answers in one shape, and gives absolute asset URLs. Astro 7+
is required, and the integration is built for Cloudflare Workers & Pages.

## Install

From GitHub (the `prepare` script builds it on install):

```sh
npm install github:Martin-Business-Consultants/libre-cms-astro
```

Or let the CMS do it. Run this in the site's project: it installs the package
and gets the site a read-only service token of its own.

```sh
curl -fsSL https://<your cms>/frontend/install.sh | sh
```

`.env` (keep it out of git):

```sh
CMS_BASE_URL=https://cms.example.com
CMS_API_TOKEN=…          # a service token on the "Production site" role
```

`astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import cms from "@librepublish/astro";

export default defineConfig({
  // Leave the adapter out for a fully static site.
  adapter: cloudflare({ prerenderEnvironment: "node" }),
  integrations: [cms()],
});
```

`src/content.config.ts`:

```ts
import { defineCollection } from "astro:content";
import { cmsAssets, cmsEntries, cmsGlobals, cmsPages } from "@librepublish/astro/loaders";

export const collections = {
  pages: defineCollection({ loader: cmsPages() }),
  posts: defineCollection({ loader: cmsEntries("posts") }),   // one per collection the site shows
  globals: defineCollection({ loader: cmsGlobals() }),
  assets: defineCollection({ loader: cmsAssets() }),          // the Media plugin's assets
};
```

## Pages

Serve each record where the CMS says it lives. That's `/` for the home page,
`/fr/…` for French, and `/<collection>/<slug>` for an entry. `routeParam`
also handles an SEO canonical, which can be an absolute URL:

```astro
---
import { getCollection } from "astro:content";
import Blocks from "@librepublish/astro/components/Blocks.astro";
import Seo from "@librepublish/astro/components/Seo.astro";
import { routeParam } from "@librepublish/astro/client";
import Hero from "../components/Hero.astro";

export async function getStaticPaths() {
  return (await getCollection("pages")).map(({ data }) => ({
    params: { path: routeParam(data, { site: import.meta.env.SITE }) },
    props: { page: data },
  }));
}
const { page } = Astro.props;
const assets = Object.fromEntries((await getCollection("assets")).map((a) => [a.id, a.data]));
---
<html lang={page.locale}>
  <head><Seo record={page} assets={assets} siteName="Acme" /></head>
  <body><Blocks blocks={page.blocks} components={{ hero: Hero }} assets={assets} /></body>
</html>
```

- **Blocks.** Each component gets its block's `data` as props, plus `block`,
  `assets` and `resolved`. `resolved` is what the CMS filled in: a
  `collection_list` gets its entries, and `contact_info` gets the contact
  details. A block type with no component is skipped.
- **Images.** `<Image asset={assets[id]} sizes="…" />` serves the asset from
  the CMS with its renditions, size, alt text and focal point.
- **Types.** `import type { HeroBlock, Collections, Globals } from "librepublish:types"`.
  These are generated on every `astro dev` and `astro build`. An unset field
  is typed `T | null`, because that's what the CMS sends.
- **Field values.** `text` fields are HTML (use `set:html`). `markdown` fields
  are Markdown. Link fields go through `linkHref(link)`.

## Forms

The Forms plugin is on by default in the CMS.

```astro
---
import Form from "@librepublish/astro/components/Form.astro";
---
<Form slug="contact" />
```

The browser posts the form straight to the CMS. Make sure Settings › General's
site URL is right, because the CMS allows that origin. With JavaScript, the
form submits in place and shows the success message or each field's error.
It's unstyled: style the `cms-form__*` classes and the form's `data-state`.
For a form you lay out yourself, use `getForm(slug)` and `getForms()` from
`@librepublish/astro/forms`.

**Form emails in the site's design.** Add a route at
`src/pages/emails/[form]/[kind].astro` (`example/` has one) that does three
things:

- uses `emailTemplatePaths` as its `getStaticPaths`;
- puts `digestMeta(email)` on a `<meta>` in its `<head>`;
- spreads `answersRow(block)` on the row the CMS repeats for each answer.

After `astro build`, `cms()` sends each template to the CMS and removes it from
the deployed site. Until a template for an email's current blocks arrives, the
CMS sends that email in its own layout. To change this, use
`cms({ formEmails: { route, keep } })`, or `formEmails: false`.

## Quotes

With the Commerce plugin switched on in the CMS:

```astro
---
import QuoteRequest from "@librepublish/astro/components/QuoteRequest.astro";
---
<QuoteRequest items={[{ title: product.title, sku: product.sku, unit_price: "$2,200.00", quantity: 1 }]} />
```

The request lands in Commerce › Quote requests, and the shop drafts an invoice
from it. The visitor gives a name, an email or phone number, a company and a
message. It works as a plain HTML form; with JavaScript it submits in place.
It's unstyled: style the `cms-quote__*` classes and the form's `data-state`.
`commerceEnabled()` from `@librepublish/astro/commerce` tells a page whether to
offer it.

## Pages rendered on demand

The build tells the CMS how the site renders. A **static** site (no adapter,
or every page prerendered) is rebuilt when content is published: point the
CMS's Settings › Deploy at a Cloudflare deploy hook or at GitHub. A site that
**renders on demand** gets a signed purge at `/_cms/webhook` instead. Set these
as the Worker's secrets:

- `CMS_WEBHOOK_SECRET`, from Settings › Deploy;
- `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` (with Cache Purge), to purge
  Cloudflare's cache by tag.

On an on-demand page:

- `Astro.locals.cms` is a client for the request. Every answer it gets is added
  to the response's `Cache-Tag`.
- Live collections (`@librepublish/astro/live`) also add their tags once you
  hand the result to `cacheHint(Astro, result.cacheHint)`.

```ts
// src/live.config.ts
import { defineLiveCollection } from "astro:content";
import { cmsLivePages } from "@librepublish/astro/live";
export const collections = { livePages: defineLiveCollection({ loader: cmsLivePages() }) };
```

Prerender in Node (`prerenderEnvironment: "node"`), because workerd doesn't read
`.env` at build time. At request time the Worker reads `CMS_BASE_URL` and
`CMS_API_TOKEN` from its variables and secrets. Locally, put them in
`.dev.vars` next to the wrangler config.

## Held to Site health

`AGENTS.md` gets the CMS's frontend guide and Site health's checklist: the
business's details, the pages a site needs, meta descriptions, alt text, and
more. Every build warns about checks that fail. Use `cms({ siteHealth: "error" })`
to make a failing check stop the build instead.

## Options

| Option | Default | |
|---|---|---|
| `url`, `token` | `CMS_BASE_URL`, `CMS_API_TOKEN` | Where the CMS is, and the site's service token. |
| `i18n` | `true` | Sets up Astro's i18n from the CMS's locales. Every locale except the default gets a path prefix. |
| `sitemap` | `true` | Adds `/sitemap.xml`, and `/robots.txt` unless `public/robots.txt` exists. After a build, the sitemap keeps only the URLs the site serves (its built pages and on-demand routes), and warns about the rest, such as a categories collection with no pages of its own. |
| `redirects` | `true` | After a build, writes the CMS's redirects into `_redirects`, after the site's own rules. |
| `formEmails` | `{ route: "emails" }` | After a build, sends the form email templates the site built to the CMS. Only runs when the CMS has Forms on. |
| `siteHealth` | `"warn"` | `"error"` stops the build on a failing check; `"off"` skips the checks. |
| `agentsMd` | `true` | Keeps the CMS's guide and the Site health checklist in `AGENTS.md`. |
| `report` | `true` | Tells the CMS about each build: how the site renders, and which content it used. |

## Entry points

| Import | |
|---|---|
| `@librepublish/astro` | `cms()`, the integration. |
| `@librepublish/astro/loaders` | `cmsPages`, `cmsEntries`, `cmsGlobals`, `cmsAssets`. |
| `@librepublish/astro/live` | `cmsLivePages`, `cmsLiveEntries`, `cacheHint`. |
| `@librepublish/astro/client` | `createClient`, `linkHref`, `recordPath`, `routeParam`, `CmsError`, and the API's types. |
| `@librepublish/astro/forms` | `getForm`, `getForms`, `emailTemplatePaths`, `digestMeta`, `answersRow`, and the form types. |
| `@librepublish/astro/commerce` | `quoteRequestAction`, `commerceEnabled`, `QuoteItem`. |
| `@librepublish/astro/components/*.astro` | `Blocks`, `Image`, `Seo`, `Form`, `QuoteRequest`. |
| `librepublish:types` | Generated from the CMS's schema. |

## Develop

```sh
npm install
npm test         # builds, then the unit tests
npm run e2e      # builds example/ against a real CMS, static and on demand
```

`npm run e2e` needs `CMS_BASE_URL` and `CMS_API_TOKEN`, pointing at a
**development** CMS: a cmsv2 checkout with its default plugins, which
`bin/setup` installs, plus Commerce if you want that covered too. The builds
report themselves to that CMS and send it the example's form email templates.

Functional Source License 1.1, with an MIT future license, like the CMS ([LICENSE.md](LICENSE.md)).
