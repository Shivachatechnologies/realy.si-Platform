import { z } from "zod";
import { LOCALES } from "@/i18n/config";

/**
 * CMS content model (pure: no server-only imports). An entry's content holds one variant per locale; each variant is a
 * list of typed blocks. Text is plain text with a tiny inline syntax (**bold**, *italic*, [label](https://…),
 * "## " headings and "- " list items) that renderers turn into React elements — never raw HTML — so published
 * content is sanitized by construction.
 */

export const CMS_LOCALES = LOCALES;
export type CmsLocale = (typeof LOCALES)[number];
export const CMS_KINDS = ["PAGE", "POST", "LANDING"] as const;
export const CMS_BLOCK_TYPES = ["hero", "features", "richText", "image", "cta", "faq", "pricing"] as const;
export type CmsBlockType = (typeof CMS_BLOCK_TYPES)[number];

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, "Use lowercase letters, digits and dashes");

/** Links: site-relative paths or http(s) URLs only (no javascript:, data:, …). */
export const safeHref = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^\/(?!\/)[^\s]*$/.test(v) || /^https?:\/\/[^\s]+$/i.test(v), "Use a path starting with / or an http(s) link");

/** Images: http(s) URLs or a CMS media reference ("media:<uuid>"). */
export const imageRef = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v) || /^media:[0-9a-f-]{36}$/i.test(v), "Use an https image URL or pick from the media library");

const text = (max: number) => z.string().max(max).default("");
const id = z.string().regex(/^[a-z0-9]{4,24}$/);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("hero"), eyebrow: text(80), title: text(160), subtitle: text(400), ctaLabel: text(60), ctaHref: safeHref.default(""), image: imageRef.default("") }),
  z.object({
    id,
    type: z.literal("features"),
    title: text(160),
    items: z.array(z.object({ title: text(120), body: text(400) })).max(12).default([]),
  }),
  z.object({ id, type: z.literal("richText"), body: text(20_000) }),
  z.object({ id, type: z.literal("image"), image: imageRef.default(""), alt: text(200), caption: text(300) }),
  z.object({ id, type: z.literal("cta"), title: text(160), body: text(400), ctaLabel: text(60), ctaHref: safeHref.default("") }),
  z.object({
    id,
    type: z.literal("faq"),
    title: text(160),
    items: z.array(z.object({ q: text(300), a: text(2000) })).max(30).default([]),
  }),
  /** Reference to the live pricing catalog (rendered from real plans, never copied prices). */
  z.object({ id, type: z.literal("pricing"), title: text(160), subtitle: text(400) }),
]);
export type CmsBlock = z.infer<typeof blockSchema>;

export const variantSchema = z.object({
  title: z.string().trim().max(200).default(""),
  summary: z.string().max(600).default(""),
  seoTitle: z.string().max(70).default(""),
  seoDescription: z.string().max(170).default(""),
  ogImage: imageRef.default(""),
  noIndex: z.boolean().default(false),
  blocks: z.array(blockSchema).max(60).default([]),
});
export type CmsVariant = z.infer<typeof variantSchema>;

export const contentSchema = z.object({
  locales: z.partialRecord(z.enum(LOCALES), variantSchema).default({}),
});
export type CmsContent = z.infer<typeof contentSchema>;

/** Parse stored JSON leniently: invalid content becomes empty rather than crashing a page. */
export function readContent(raw: unknown): CmsContent {
  const r = contentSchema.safeParse(raw);
  return r.success ? r.data : { locales: {} };
}

/** The variant for a locale, falling back to en-US, then to any filled locale. */
export function pickVariant(content: CmsContent, locale: string): { locale: CmsLocale; variant: CmsVariant } | null {
  const order = [locale, "en-US", ...LOCALES] as CmsLocale[];
  for (const l of order) {
    const v = content.locales[l];
    if (v && (v.title || v.blocks.length)) return { locale: l, variant: v };
  }
  return null;
}

// ───────────── Email templates ─────────────

/** Platform transactional templates and the variables each one receives. */
export const EMAIL_TEMPLATE_DEFS = {
  verify_email: { vars: ["name", "link"] },
  password_reset: { vars: ["name", "link"] },
  invitation: { vars: ["inviter", "organization", "link"] },
  briefing: { vars: ["name", "company", "summary", "link"] },
  "support.ticket_received": { vars: ["name", "subject", "ticket", "link"] },
  announcement: { vars: ["name", "title", "body", "link"] },
} as const;
export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATE_DEFS;
export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATE_DEFS) as EmailTemplateKey[];
export const isEmailTemplateKey = (v: string): v is EmailTemplateKey => v in EMAIL_TEMPLATE_DEFS;

/** Replace {{var}} placeholders (unknown variables become empty). */
export function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
