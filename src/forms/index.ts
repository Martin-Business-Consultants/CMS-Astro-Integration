/**
 * The CMS's forms on the site (the Forms plugin, on in every install by
 * default):
 *
 *   ---
 *   import Form from "@librepublish/astro/components/Form.astro";
 *   ---
 *   <Form slug="contact" />
 *
 * `getForm` and `getForms` give a form to render yourself. The browser posts
 * straight to the CMS (`form.action`), never through the site.
 *
 * Form emails in the site's design: a route at
 * src/pages/emails/[form]/[kind].astro renders each email's blocks with the
 * site's components — `emailTemplatePaths` as its getStaticPaths,
 * `digestMeta(email)` on a <meta> in its <head>, `answersRow(block)` on the
 * row the CMS repeats per answer — and cms() sends what it built to the CMS
 * after `astro build`, then takes it out of the deployed site.
 */
import { CmsError } from "../client.js";
import { buildClient } from "../build-connection.js";
import { runtimeClient } from "../runtime/env.js";
import { DIGEST_META, type CmsEmailBlock, type CmsForm, type CmsFormEmail } from "./types.js";

export type * from "./types.js";
export { DIGEST_META };

/** A published form, by slug. */
export async function getForm(slug: string): Promise<CmsForm> {
  try {
    return (await runtimeClient().get<CmsForm>(`/forms/${encodeURIComponent(slug)}`)).data;
  } catch (error) {
    throw explain(error, `the form "${slug}"`);
  }
}

/** Every published form. */
export async function getForms(): Promise<CmsForm[]> {
  try {
    return (await runtimeClient().get<CmsForm[]>("/forms")).data;
  } catch (error) {
    throw explain(error, "the forms");
  }
}

/**
 * getStaticPaths for the email route: one page per form and kind, with the
 * form's slug and the email as props. Every form, published or not, so a
 * draft form's emails are ready when it goes live. Build time only.
 */
export async function emailTemplatePaths() {
  const cms = buildClient();
  const { forms } = await cms.admin<{ forms: { slug: string }[] }>("/forms");
  const perForm = await Promise.all(forms.map(async (form) => {
    const { emails } = await cms.admin<{ emails: CmsFormEmail[] }>(`/forms/${encodeURIComponent(form.slug)}/emails`);
    return emails.map((email) => ({ params: { form: form.slug, kind: email.kind }, props: { form: form.slug, email } }));
  }));
  return perForm.flat();
}

/** Spread onto a <meta> in the template's <head>. */
export function digestMeta(email: CmsFormEmail) {
  return { name: DIGEST_META, content: email.content_digest };
}

/** Spread onto the row the CMS repeats per answer ({{answer.label}}, {{answer.value}}). */
export function answersRow(block: Extract<CmsEmailBlock, { type: "email_submission" }>) {
  return { "data-cms-repeat": "answers", ...(block.data.skip_empty ? { "data-cms-skip-empty": "true" } : {}) };
}

function explain(error: unknown, what: string): unknown {
  if (!(error instanceof CmsError)) return error;
  if (error.status === 404) {
    return new CmsError(`CMS: ${what} isn't published, or the Forms plugin is off (Settings › Plugins).`, 404, error.path, error.body);
  }
  return error;
}
