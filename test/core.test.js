import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient, CmsError } from "../dist/client.js";
import { generateTypes } from "../dist/codegen.js";
import { keepConnection } from "../dist/connection.js";
import { cmsPages, cmsEntries } from "../dist/loaders.js";
import { healthChecklist } from "../dist/build-checks.js";
import { cloudflareRedirects, shadowedPages } from "../dist/redirects.js";
import { shapeSitemap, sitePath } from "../dist/site-paths.js";

const envelope = (data, meta = {}, included) => ({ data, meta, ...(included ? { included } : {}) });

function fakeFetch(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname + new URL(url).search;
    const route = routes[path] ?? routes[new URL(url).pathname];
    if (!route) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    const { body, status = 200, headers = {} } = typeof route === "function" ? route(path) : route;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  };
  return { fetcher, calls };
}

test("the client sends the token, unwraps nothing and collects cache tags", async () => {
  const { fetcher, calls } = fakeFetch({
    "/api/v1/pages/about": { body: envelope({ path: "about" }), headers: { "Cache-Tag": "page:about,pages" } },
  });
  const cms = createClient({ url: "https://cms.test/", token: "t0k", fetch: fetcher });
  const { data } = await cms.page("/about/");
  assert.equal(data.path, "about");
  assert.equal(calls[0].url, "https://cms.test/api/v1/pages/about");
  assert.equal(calls[0].init.headers.Authorization, "Bearer t0k");
  assert.deepEqual([...cms.tags], ["page:about", "pages"]);
});

test("the client follows every page of a list and merges the assets", async () => {
  const { fetcher } = fakeFetch({
    "/api/v1/pages?per=100&page=1": { body: envelope([{ path: "a" }], { next_page: 2 }, { assets: { 1: { id: 1 } } }) },
    "/api/v1/pages?per=100&page=2": { body: envelope([{ path: "b" }], { next_page: null }, { assets: { 2: { id: 2 } } }) },
  });
  const cms = createClient({ url: "https://cms.test", token: "t", fetch: fetcher });
  const { data, included } = await cms.pages();
  assert.deepEqual(data.map((page) => page.path), ["a", "b"]);
  assert.deepEqual(Object.keys(included.assets), ["1", "2"]);
});

test("a refused token is a CmsError that says so", async () => {
  const { fetcher } = fakeFetch({ "/api/v1/site": { body: { error: "unauthorized" }, status: 401 } });
  const cms = createClient({ url: "https://cms.test", token: "bad", fetch: fetcher });
  await assert.rejects(cms.site(), (error) => error instanceof CmsError && error.status === 401 && /refused/.test(error.message));
});

test("types come from the schema, with the CMS's field types", () => {
  const ts = generateTypes({
    block_types: { hero_banner: { title: "Hero", version: 1, data: { type: "object", required: ["heading"], properties: {
      heading: { type: "string", title: "Heading", "x-cms-type": "string" },
      image: { type: "string", "x-cms-type": "asset" },
      cta: { type: "object", "x-cms-type": "link", properties: {} },
      size: { type: "string", enum: ["s", "l"], "x-cms-type": "select" },
      items: { type: "array", items: { type: "object", properties: { label: { type: "string" } } }, "x-cms-type": "repeater" },
      related: { type: "array", items: { type: "string" }, "x-cms-type": "record_refs" },
    } } } },
    collections: { posts: { title: "Posts", enable_blocks: false, frontmatter: { type: "object", properties: { cover: { type: "string", "x-cms-type": "asset" } } } } },
    globals: { footer: { title: "Footer", data: { type: "object", properties: {} } } },
    pages: {},
    seo: { type: "object", properties: { meta_title: { type: "string" } } },
  });
  assert.match(ts, /declare module "librepublish:types"/);
  assert.match(ts, /export type HeroBannerBlock = \{/);
  assert.match(ts, /"heading": string;/);
  assert.match(ts, /"image"\?: AssetId \| null;/);
  assert.match(ts, /"cta"\?: Link \| null;/);
  assert.match(ts, /"size"\?: "s" \| "l" \| null;/);
  assert.match(ts, /"items"\?: Array<\{/);
  assert.match(ts, /"related"\?: RecordRef\[\] \| null;/);
  assert.match(ts, /"hero_banner": HeroBannerBlock;/);
  assert.match(ts, /"posts": CmsEntry<PostsFields>;/);
  assert.match(ts, /"footer": CmsGlobal<FooterGlobal>;/);
});

function fakeContext(meta = {}) {
  const entries = new Map();
  return {
    entries,
    context: {
      store: { set: (entry) => entries.set(entry.id, entry), delete: (id) => entries.delete(id), clear: () => entries.clear() },
      meta: { get: (key) => meta[key], set: (key, value) => { meta[key] = value; } },
      parseData: async ({ data }) => data,
      generateDigest: (data) => JSON.stringify(data).length.toString(),
      logger: { info() {} },
    },
    meta,
  };
}

test("loaders load everything, then apply what changed and drop what stopped being live", async () => {
  const content = {
    "/api/v1/content": { body: envelope({ pages: [{ path: "about" }, { path: "gone" }], entries: [{ collection: "posts", slug: "hi" }, { collection: "news", slug: "x" }], globals: [], removed: { pages: [], entries: [], globals: [] } }, { cursor: "c1", full: true }) },
    "/api/v1/content?since=c1": { body: envelope({ pages: [{ path: "about", title: "New" }], entries: [], globals: [], removed: { pages: [{ id: 2, path: "gone" }], entries: [], globals: [] } }, { cursor: "c2", full: false }) },
  };
  const { fetcher } = fakeFetch(content);
  globalThis.fetch = fetcher;
  keepConnection({ url: "https://cms.test", token: "t" });

  const pages = fakeContext();
  await cmsPages().load(pages.context);
  assert.deepEqual([...pages.entries.keys()], ["about", "gone"]);
  assert.equal(pages.meta.cursor, "c1");

  const posts = fakeContext();
  await cmsEntries("posts").load(posts.context);
  assert.deepEqual([...posts.entries.keys()], ["hi"]);

  await new Promise((resolve) => setTimeout(resolve, 10));
  await cmsPages().load(pages.context);
  assert.deepEqual([...pages.entries.keys()], ["about"]);
  assert.equal(pages.entries.get("about").data.title, "New");
  assert.equal(pages.meta.cursor, "c2");
});

test("Site health becomes a checklist grouped as the CMS groups it", () => {
  const md = healthChecklist([
    { key: "a", group: "Pages a site needs", title: "Privacy policy", detail: "Required.", ok: false, state: "fails" },
    { key: "b", group: "Pages a site needs", title: "Terms", detail: "Expected.", ok: true, state: "passes" },
    { key: "c", group: "Business details", title: "Profile matches", detail: "Check it.", ok: null, state: "yours_to_judge" },
  ]);
  assert.match(md, /### Pages a site needs\n- \[ \] \*\*Privacy policy\*\* — Required\.\n- \[x\] \*\*Terms\*\*/);
  assert.match(md, /Profile matches\*\* — Check it\. _\(yours to judge\)_/);
});

test("the purge webhook takes only the CMS's signature", async () => {
  const { verify } = await import("../dist/runtime/signature.js");
  const body = JSON.stringify({ event: "cms.purge", tags: ["page:about"] });
  const good = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
  assert.equal(await verify(body, good, "s3cret"), true);
  assert.equal(await verify(body, good, "other"), false);
  assert.equal(await verify(body + " ", good, "s3cret"), false);
  assert.equal(await verify(body, null, "s3cret"), false);
});

test("linkHref turns a CMS link into an href, home at the root", async () => {
  const { linkHref } = await import("../dist/client.js");
  assert.equal(linkHref({ kind: "url", value: "https://x.test" }), "https://x.test");
  assert.equal(linkHref({ kind: "page", value: "home" }), "/");
  assert.equal(linkHref({ kind: "page", value: "about/team" }), "/about/team");
  assert.equal(linkHref({ kind: "page", value: "home" }, { locale: "fr", defaultLocale: "en" }), "/fr");
  assert.equal(linkHref({ kind: "entry", value: "hello", collection: "posts" }), "/posts/hello");
  assert.equal(linkHref(null), undefined);
});

test("recordPath routes by url, and by the record's own path when a canonical points elsewhere", async () => {
  const { recordPath, routeParam } = await import("../dist/client.js");
  assert.equal(recordPath({ url: "/", path: "home", locale: "en" }), "/");
  assert.equal(recordPath({ url: "/about/team/", path: "about/team", locale: "en" }), "/about/team");
  assert.equal(recordPath({ url: "/fr/a-propos", path: "a-propos", locale: "fr" }), "/fr/a-propos");
  assert.equal(recordPath({ url: "https://acme.test/landing", path: "about", locale: "en" }, { site: "https://acme.test" }), "/landing");
  assert.equal(recordPath({ url: "https://partner.test/x", path: "about", locale: "en" }, { site: "https://acme.test" }), "/about");
  assert.equal(recordPath({ url: "https://partner.test/x", path: "home", locale: "fr" }, { site: "https://acme.test", defaultLocale: "en" }), "/fr");
  assert.equal(recordPath({ url: "https://partner.test/x", collection: "posts", slug: "hi", locale: "en" }, { site: "https://acme.test" }), "/posts/hi");
  assert.equal(routeParam({ url: "/", path: "home", locale: "en" }), undefined);
  assert.equal(routeParam({ url: "/posts/hi", collection: "posts", slug: "hi", locale: "en" }), "posts/hi");
});

test("the client encodes each path segment", async () => {
  const { fetcher, calls } = fakeFetch({ "/api/v1/pages/a%20b/c": { body: envelope({ path: "a b/c" }) } });
  const cms = createClient({ url: "https://cms.test", token: "t", fetch: fetcher });
  await cms.page("a b/c");
  assert.equal(calls[0].url, "https://cms.test/api/v1/pages/a%20b/c");
});

test("the version reported to the CMS is package.json's", async () => {
  const { VERSION, NAME } = await import("../dist/index.js");
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
  assert.equal(NAME, "librepublish");
});

test("the integration's entry loads in plain Node: nothing it imports needs Astro's virtual modules", async () => {
  const { readFile } = await import("node:fs/promises");
  const seen = new Set();
  async function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /^(import|export)[^;]*from "astro:/m, `${file} imports an astro: module`);
    for (const [, spec] of source.matchAll(/^(?:import|export)[^;]*from "(\.{1,2}\/[^"]+)"/gm)) await walk(new URL(spec, new URL(file, import.meta.url)).href);
  }
  await walk("../dist/index.js");
  assert.ok(seen.size > 5);
});

test("form email templates: found by form and kind, digest read from the meta tag", async () => {
  const { mkdtemp, mkdir, writeFile, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { findTemplates, readDigest, sendTemplates } = await import("../dist/form-emails.js");
  const dir = await mkdtemp(join(tmpdir(), "lp-"));
  await mkdir(join(dir, "emails/contact/notification"), { recursive: true });
  await writeFile(join(dir, "emails/contact/notification/index.html"), '<html><head><meta name="cms-email-digest" content="abc"></head></html>');
  await writeFile(join(dir, "emails/contact/confirmation.html"), "<html></html>");
  const found = await findTemplates(join(dir, "emails"));
  assert.deepEqual(found.map((t) => `${t.form}/${t.kind}`).sort(), ["contact/confirmation", "contact/notification"]);
  assert.equal(readDigest('<meta content="x" name="cms-email-digest">'), "x");
  assert.equal(readDigest('<meta name="description" content="y">'), null);
  assert.equal(readDigest('<meta name="cms-email-digest" content="d1">'), "d1");

  // A template without its digest fails the build rather than going out stale.
  const client = createClient({ url: "https://cms.test", token: "t", fetch: async () => new Response("{}") });
  await assert.rejects(sendTemplates(client, pathToFileURL(dir + "/"), { route: "emails", keep: true }, { info() {} }), /no <meta name="cms-email-digest">/);

  await writeFile(join(dir, "emails/contact/confirmation.html"), '<meta name="cms-email-digest" content="d2">');
  const { fetcher, calls } = fakeFetch({
    "/api/forms/contact/emails/notification/template": { body: { site_template: { status: "current" } } },
    "/api/forms/contact/emails/confirmation/template": { body: { site_template: { status: "current" } } },
  });
  const sent = await sendTemplates(createClient({ url: "https://cms.test", token: "t", fetch: fetcher }), pathToFileURL(dir + "/"), { route: "emails", keep: false }, { info() {} });
  assert.equal(sent, 2);
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ["digest", "html"]);
  assert.deepEqual(await readdir(dir), []);
});

test("a 403 names the capability the role is missing", async () => {
  const { fetcher } = fakeFetch({ "/api/v1/forms/contact": { body: { error: "forbidden", capability: "forms:read" }, status: 403 } });
  const cms = createClient({ url: "https://cms.test", token: "t", fetch: fetcher });
  await assert.rejects(cms.get("/forms/contact"), (error) => error.status === 403 && /forms:read/.test(error.message));
});

test("sitemap.xml keeps only what the site serves: built pages and on-demand routes", async () => {
  const { servedSitemap } = await import("../dist/sitemap-filter.js");
  const url = (loc) => `  <url>\n    <loc>${loc}</loc>\n  </url>\n`;
  const xml = `<?xml version="1.0"?>\n<urlset>\n${url("https://acme.test/")}${url("https://acme.test/about")}${url("https://acme.test/categories/appetizer")}${url("https://acme.test/live/x")}${url("https://acme.test/posts/a&amp;b")}</urlset>\n`;
  const { xml: kept, removed } = servedSitemap(xml, ["", "about/", "posts/a&b"], [/^\/live(?:\/(.*?))?\/?$/]);
  assert.deepEqual(removed, ["/categories/appetizer"]);
  assert.match(kept, /acme\.test\/about/);
  assert.match(kept, /acme\.test\/live\/x/);
  assert.match(kept, /a&amp;b/);
  assert.doesNotMatch(kept, /appetizer/);
});

test("site paths take the site's trailingSlash; \"/\", files and other hosts don't change", () => {
  assert.equal(sitePath("/menu", "always"), "/menu/");
  assert.equal(sitePath("/menu/?a=1#b", "never"), "/menu?a=1#b");
  assert.equal(sitePath("/menu?a=1", "always"), "/menu/?a=1");
  assert.equal(sitePath("/", "always"), "/");
  assert.equal(sitePath("/feed.xml", "always"), "/feed.xml");
  assert.equal(sitePath("/menu", "ignore"), "/menu");
  assert.equal(sitePath("https://elsewhere.test/a", "always"), "https://elsewhere.test/a");
});

test("sitemap.xml: every loc and hreflang absolute on the site, in the form it serves", () => {
  const xml = [
    "<url><loc>/</loc></url>",
    "<url><loc>/menu</loc><xhtml:link rel=\"alternate\" hreflang=\"fr\" href=\"/fr/menu\"/></url>",
    "<url><loc>https://acme.test/about</loc></url>",
    "<url><loc>https://elsewhere.test/x</loc></url>",
    "<url><loc>/a?b=1&amp;c=2</loc></url>",
  ].join("\n");
  const shaped = shapeSitemap(xml, "https://acme.test", "always");
  assert.match(shaped, /<loc>https:\/\/acme\.test\/<\/loc>/);
  assert.match(shaped, /<loc>https:\/\/acme\.test\/menu\/<\/loc>/);
  assert.match(shaped, /href="https:\/\/acme\.test\/fr\/menu\/"/);
  assert.match(shaped, /<loc>https:\/\/acme\.test\/about\/<\/loc>/);
  assert.match(shaped, /<loc>https:\/\/elsewhere\.test\/x<\/loc>/);
  assert.match(shaped, /<loc>https:\/\/acme\.test\/a\/\?b=1&amp;c=2<\/loc>/);
  // No site URL anywhere: paths stay paths, only reshaped.
  assert.match(shapeSitemap("<loc>/menu</loc>", undefined, "always"), /<loc>\/menu\/<\/loc>/);
});

test("_redirects: each plain path with and without its slash, destinations in the site's form", () => {
  const rules = cloudflareRedirects([
    "/old /new 301",
    "/gone/ / 301",
    "/old/ /elsewhere 302",
    "/blog/* /posts/:splat 301",
    "/feed.xml /rss.xml 301",
    "/out https://elsewhere.test/x 302",
    "",
  ].join("\n"), "always");
  assert.deepEqual(rules.text.trim().split("\n"), [
    "/old /new/ 301",
    "/old/ /new/ 301",
    "/gone / 301",
    "/gone/ / 301",
    "/blog/* /posts/:splat 301",
    "/feed.xml /rss.xml 301",
    "/out https://elsewhere.test/x 302",
    "/out/ https://elsewhere.test/x 302",
  ]);
  assert.equal(rules.dynamic, 1);
  assert.equal(rules.static, 7);
  assert.equal(cloudflareRedirects("/a /b 301\n").text, "/a /b 301\n/a/ /b 301\n");
});

test("_redirects: a rule that sends visitors away from a built page is found", () => {
  const rules = "/food/a /menu/a/ 301\n/food/a/ /menu/a/ 301\n/gone / 301\n/blog/* /posts/:splat 301\n";
  assert.deepEqual(shadowedPages(rules, ["food/a/", "menu/a/", "", "blog/x/"]), ["/food/a"]);
});
