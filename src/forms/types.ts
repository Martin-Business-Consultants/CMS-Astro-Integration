export type FieldType = "text" | "email" | "tel" | "url" | "textarea" | "select" | "radio" | "checkbox" | "file";

export interface CmsFormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  accept?: string;
  [key: string]: unknown;
}

/** A published form as GET /api/v1/forms/:slug gives it (the Forms plugin). */
export interface CmsForm {
  id: number;
  slug: string;
  title: string;
  fields: CmsFormField[];
  submit_label: string | null;
  success_message: string | null;
  /** Where the browser posts: the CMS's submission endpoint. */
  action: string;
  /** The field to leave empty; bots fill it in. */
  honeypot: string;
  captcha: { provider: "turnstile" | "recaptcha"; site_key: string } | null;
  updated_at: string;
}

export type CmsEmailBlock =
  | { id?: string; type: "email_heading"; version: number; data: { text: string; level?: "h1" | "h2" | "h3"; align?: "left" | "center" } }
  | { id?: string; type: "email_text"; version: number; data: { body: string } }
  | { id?: string; type: "email_button"; version: number; data: { label: string; url: string; align?: "left" | "center" } }
  | { id?: string; type: "email_image"; version: number; data: { asset: string; alt?: string; url?: string; align?: "left" | "center" }; resolved?: { url: string | null } }
  | { id?: string; type: "email_submission"; version: number; data: { title?: string; skip_empty?: boolean } }
  | { id?: string; type: "email_divider"; version: number; data: Record<string, never> }
  | { id?: string; type: "email_spacer"; version: number; data: { size?: "small" | "medium" | "large" } };

/** What the CMS answers when a submission is refused: an `error` code, and per-field messages for "invalid". */
export interface CmsFormRejection {
  error: "invalid" | "captcha_failed" | "rate_limited" | "not_found" | string;
  errors?: Record<string, string[]>;
}

export interface CmsFormEmail {
  id: number;
  kind: "notification" | "confirmation";
  enabled: boolean;
  subject: string;
  blocks: CmsEmailBlock[];
  /** Stamp this into the template you build (digestMeta). */
  content_digest: string;
  site_template?: { status: string | null; received_at: string | null };
}

/** The meta tag a form email template's digest goes in (digestMeta). */
export const DIGEST_META = "cms-email-digest";
