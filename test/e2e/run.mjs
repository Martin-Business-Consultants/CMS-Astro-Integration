// Builds the example site against a real CMS and checks what came out:
// static, then on demand (SSR=1). Needs CMS_BASE_URL and CMS_API_TOKEN (a
// Production site service token); with the CMS's default plugins (Forms,
// Media) it checks those too.
//
//   CMS_BASE_URL=http://127.0.0.1:3000 CMS_API_TOKEN=mbcs_… npm run e2e
//
// The builds report themselves to that CMS, and send it the example's form
// email templates — run it against a development CMS, not a live site's.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const example = fileURLToPath(new URL("../../example/", import.meta.url));
const { CMS_BASE_URL: url, CMS_API_TOKEN: token } = process.env;
if (!url || !token) {
  console.error("Set CMS_BASE_URL and CMS_API_TOKEN (a development CMS and a Production site token).");
  process.exit(2);
}

const site = await (await fetch(`${url}/api/v1/site`, { headers: { Authorization: `Bearer ${token}` } })).json();
const plugins = site.data.plugins;
console.log(`CMS ${site.meta.cms_version}, plugins: ${plugins.join(", ") || "none"}`);

const run = (env) => execFileSync("npx", ["astro", "build"], { cwd: example, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const read = (path) => readFileSync(new URL(path, `file://${example}`), "utf8");

if (!existsSync(`${example}node_modules`)) execFileSync("npm", ["install"], { cwd: example, stdio: "inherit" });

for (const mode of ["static", "on demand"]) {
  rmSync(`${example}dist`, { recursive: true, force: true });
  const log = run(mode === "static" ? {} : { SSR: "1" });
  const out = mode === "static" ? "dist/" : "dist/client/";

  assert.match(log, /Reported the build to the CMS \((static|hybrid|server)\)/, `${mode}: the build reports itself`);
  assert.ok(existsSync(`${example}${out}index.html`), `${mode}: the home page`);
  assert.match(read(`${out}sitemap.xml`), /<urlset/, `${mode}: sitemap.xml`);
  assert.match(read(`${out}robots.txt`), /Sitemap: /, `${mode}: robots.txt`);
  assert.match(read(`${out}_redirects`), /# From the CMS/, `${mode}: _redirects`);
  assert.match(read("AGENTS.md"), /<!-- librepublish:cms -->/, `${mode}: AGENTS.md`);
  assert.match(read(".astro/integrations/librepublish/cms.d.ts"), /declare module "librepublish:types"/, `${mode}: generated types`);

  if (plugins.includes("forms")) {
    assert.match(read(`${out}contact/index.html`), /data-cms-form/, `${mode}: <Form>`);
    assert.ok(!existsSync(`${example}${out}emails`), `${mode}: form email templates left out of the site`);
  }
  if (plugins.includes("media")) assert.match(log, /librepublish-assets\] (loaded|updated)/, `${mode}: assets`);
  if (mode === "on demand") assert.ok(existsSync(`${example}dist/server`), "on demand: the Worker");
  console.log(`✓ ${mode}`);
}
