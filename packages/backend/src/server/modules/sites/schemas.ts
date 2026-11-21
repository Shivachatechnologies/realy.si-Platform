import { z } from "zod";
import { LOCALES } from "@/i18n/config";

/**
 * Company website content model (pure: no server-only imports, safe for client components). Adapted from the platform
 * CMS block model (modules/cms/schemas.ts): a page is a list of typed blocks; text is plain text with the same tiny
 * inline syntax (**bold**, *italic*, [label](https://…), "## " headings, "- " list items) that the renderer turns into
 * React elements — never raw HTML — so published content is sanitized by construction.
 *
 * Differences from the CMS: images are company visual assets ("asset:<uuid>", served same-origin), testimonials must
 * reference a real CRM customer account, pricing cards reference the company's real products, and there are contact
 * form and logo strip blocks.
 */

export const SITE_LOCALES = LOCALES;
export const SITE_PAGE_KINDS = ["PAGE", "LANDING"] as const;
export type SitePageKind = (typeof SITE_PAGE_KINDS)[number];
export const SITE_BLOCK_TYPES = ["hero", "features", "richText", "image", "cta", "faq", "testimonials", "pricing", "contactForm", "logoStrip"] as const;
export type SiteBlockType = (typeof SITE_BLOCK_TYPES)[number];
export const SITE_FONTS = ["modern", "display", "classic", "mono"] as const;
export type SiteFont = (typeof SITE_FONTS)[number];
export const SITE_STYLES = ["soft", "bold", "minimal"] as const;
export type SiteStyle = (typeof SITE_STYLES)[number];
export const SITE_RADII = ["rounded", "square", "pill"] as const;
export const CONTACT_FIELDS = ["name", "email", "phone", "company", "message"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export const FEATURE_ICONS = ["sparkles", "check", "shield", "zap", "heart", "star", "clock", "globe", "users", "chart"] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];
export const SITE_TEMPLATES = ["services", "product", "local", "landing"] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number];

/** Names that would collide with platform paths or mislead visitors. */
const RESERVED = new Set(["admin", "api", "app", "www", "realy", "help", "support", "status", "login", "signin", "signup", "static", "assets", "s", "mail", "blog", "docs"]);

/** Platform-wide site address (/s/<slug>): 3–48 lowercase letters, digits and dashes. */
export const siteSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use 3–48 lowercase letters, digits and dashes")
  .refine((v) => !RESERVED.has(v), "This address is reserved");

const SEGMENT = "[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?";
/** Page path inside a site: "" is the home page, else up to three lowercase segments ("about", "offers/spring"). */
export const pagePathSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^\/+|\/+$/g, ""))
  .pipe(z.string().regex(new RegExp(`^(?:${SEGMENT}(?:/${SEGMENT}){0,2})?$`), "Use lowercase letters, digits and dashes"));

/** Links: site paths, in-page anchors, http(s), mailto: and tel: only (no javascript:, data:, …). */
export const SAFE_HREF = /^(\/(?!\/)[^\s]*|#[A-Za-z0-9_-]{1,60}|https?:\/\/[^\s]+|mailto:[^\s]+|tel:\+?[0-9 ()-]{3,30})$/i;
export const safeHref = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || SAFE_HREF.test(v), "Use a path starting with /, an #anchor, or an http(s), mailto: or tel: link");

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Images: a visual asset of the company's asset library ("asset:<uuid>"). */
export const assetRef = z
  .string()
  .trim()
  .max(60)
  .refine((v) => v === "" || new RegExp(`^asset:${UUID}$`, "i").test(v), "Choose an image from your asset library");
export const isAssetRef = (v: string) => new RegExp(`^asset:${UUID}$`, "i").test(v);
export const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1764ff");

const text = (max: number) => z.string().max(max).default("");
const blockId = z.string().regex(/^[a-z0-9]{4,24}$/);
const uuid = z.string().uuid();

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    id: blockId,
    type: z.literal("hero"),
    eyebrow: text(80),
    title: text(160),
    subtitle: text(400),
    ctaLabel: text(60),
    ctaHref: safeHref.default(""),
    secondaryLabel: text(60),
    secondaryHref: safeHref.default(""),
    image: assetRef.default(""),
    layout: z.enum(["split", "centered"]).default("split"),
  }),
  z.object({
    id: blockId,
    type: z.literal("features"),
    title: text(160),
    subtitle: text(400),
    items: z.array(z.object({ icon: z.enum(FEATURE_ICONS).default("sparkles"), title: text(120), body: text(400) })).max(12).default([]),
  }),
  z.object({ id: blockId, type: z.literal("richText"), body: text(20_000) }),
  z.object({ id: blockId, type: z.literal("image"), image: assetRef.default(""), alt: text(200), caption: text(300), width: z.enum(["content", "wide"]).default("wide") }),
  z.object({ id: blockId, type: z.literal("cta"), title: text(160), body: text(400), ctaLabel: text(60), ctaHref: safeHref.default("") }),
  z.object({ id: blockId, type: z.literal("faq"), title: text(160), items: z.array(z.object({ q: text(300), a: text(2000) })).max(30).default([]) }),
  /** Quotes from real customers only: every item references a CRM account of type CUSTOMER (checked on save and render). */
  z.object({
    id: blockId,
    type: z.literal("testimonials"),
    title: text(160),
    items: z.array(z.object({ accountId: uuid, quote: text(600), author: text(120), role: text(120) })).max(9).default([]),
  }),
  /** Pricing cards for the company's real products (name and description come from the product record). */
  z.object({
    id: blockId,
    type: z.literal("pricing"),
    title: text(160),
    subtitle: text(400),
    items: z
      .array(z.object({ productId: uuid, price: text(40), period: text(40), features: z.array(z.string().max(160)).max(10).default([]), highlight: z.boolean().default(false), ctaLabel: text(60), ctaHref: safeHref.default("") }))
      .max(6)
      .default([]),
  }),
  z.object({
    id: blockId,
    type: z.literal("contactForm"),
    title: text(160),
    body: text(600),
    fields: z
      .array(z.object({ key: z.enum(CONTACT_FIELDS), required: z.boolean().default(false) }))
      .max(CONTACT_FIELDS.length)
      .default([
        { key: "name", required: true },
        { key: "email", required: true },
        { key: "message", required: false },
      ])
      .transform((f) => {
        const seen = new Set<string>();
        const out = f.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
        // Email is how the company answers; it is always asked and required.
        return out.some((x) => x.key === "email") ? out.map((x) => (x.key === "email" ? { ...x, required: true } : x)) : [{ key: "email" as const, required: true }, ...out];
      }),
    submitLabel: text(60),
    successMessage: text(300),
    /** Shown next to the required consent checkbox and stored with every submission. */
    consentText: text(600),
  }),
  z.object({ id: blockId, type: z.literal("logoStrip"), title: text(160), items: z.array(z.object({ name: text(120), image: assetRef.default("") })).max(12).default([]) }),
]);
export type SiteBlock = z.infer<typeof blockSchema>;
export type SiteBlockOf<T extends SiteBlockType> = Extract<SiteBlock, { type: T }>;

export const pageSeoSchema = z.object({
  title: z.string().trim().max(70).default(""),
  description: z.string().trim().max(170).default(""),
  ogImage: assetRef.default(""),
  noIndex: z.boolean().default(false),
});
export type PageSeo = z.infer<typeof pageSeoSchema>;

export const pageContentSchema = z.object({
  title: z.string().trim().max(160).default(""),
  seo: pageSeoSchema.default({ title: "", description: "", ogImage: "", noIndex: false }),
  blocks: z.array(blockSchema).max(60).default([]),
});
export type PageContent = z.infer<typeof pageContentSchema>;

export const themeSchema = z.object({
  brandColor: hexColor.default("#1764ff"),
  accentColor: hexColor.default("#0b1220"),
  font: z.enum(SITE_FONTS).default("modern"),
  logoAssetId: uuid.nullable().default(null),
  style: z.enum(SITE_STYLES).default("soft"),
  radius: z.enum(SITE_RADII).default("rounded"),
});
export type SiteTheme = z.infer<typeof themeSchema>;

export const navSchema = z.array(z.object({ label: z.string().trim().min(1).max(40), href: safeHref })).max(8).default([]);
export type SiteNav = z.infer<typeof navSchema>;

export const footerSchema = z.object({
  text: z.string().trim().max(400).default(""),
  links: z.array(z.object({ label: z.string().trim().min(1).max(40), href: safeHref })).max(8).default([]),
  showPoweredBy: z.boolean().default(true),
});
export type SiteFooter = z.infer<typeof footerSchema>;

export const siteSeoSchema = z.object({
  title: z.string().trim().max(70).default(""),
  description: z.string().trim().max(170).default(""),
  ogImage: assetRef.default(""),
  noIndex: z.boolean().default(false),
});
export type SiteSeo = z.infer<typeof siteSeoSchema>;

// ───────────── Lenient readers (stored JSON never crashes a page) ─────────────

export const readTheme = (raw: unknown): SiteTheme => themeSchema.safeParse(raw ?? {}).data ?? themeSchema.parse({});
export const readNav = (raw: unknown): SiteNav => navSchema.safeParse(raw ?? []).data ?? [];
export const readFooter = (raw: unknown): SiteFooter => footerSchema.safeParse(raw ?? {}).data ?? footerSchema.parse({});
export const readSiteSeo = (raw: unknown): SiteSeo => siteSeoSchema.safeParse(raw ?? {}).data ?? siteSeoSchema.parse({});

/** Page content with invalid blocks dropped one by one (one bad block never empties a page). */
export function readContent(raw: unknown): PageContent {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { title?: unknown; seo?: unknown; blocks?: unknown };
  const blocks = (Array.isArray(obj.blocks) ? obj.blocks : []).flatMap((b) => {
    const r = blockSchema.safeParse(b);
    return r.success ? [r.data] : [];
  });
  return {
    title: typeof obj.title === "string" ? obj.title.slice(0, 160) : "",
    seo: pageSeoSchema.safeParse(obj.seo ?? {}).data ?? pageSeoSchema.parse({}),
    blocks: blocks.slice(0, 60),
  };
}

// ───────────── Helpers ─────────────

export const assetIdOf = (ref: string) => (isAssetRef(ref) ? ref.slice(6).toLowerCase() : null);

/** Visual assets referenced by blocks (hero/image/logo strip) and the SEO image. */
export function contentAssetIds(c: PageContent): string[] {
  const refs: string[] = [c.seo.ogImage];
  for (const b of c.blocks) {
    if (b.type === "hero" || b.type === "image") refs.push(b.image);
    if (b.type === "logoStrip") refs.push(...b.items.map((i) => i.image));
  }
  return [...new Set(refs.map(assetIdOf).filter((x): x is string => !!x))];
}
export const contentAccountIds = (c: PageContent) => [...new Set(c.blocks.flatMap((b) => (b.type === "testimonials" ? b.items.map((i) => i.accountId) : [])))];
export const contentProductIds = (c: PageContent) => [...new Set(c.blocks.flatMap((b) => (b.type === "pricing" ? b.items.map((i) => i.productId) : [])))];

export function newBlockId(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** An empty block of a type (the editor's "Add block"). */
export function emptyBlock(type: SiteBlockType): SiteBlock {
  return blockSchema.parse({ id: newBlockId(), type });
}

/** Readable text colour on a background colour (WCAG relative luminance). */
export function contrastOn(hex: string): "#ffffff" | "#0b1220" {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#ffffff";
  const lin = (v: string) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!);
  return l > 0.45 ? "#0b1220" : "#ffffff";
}

/** "/s/<slug>" + page path. */
export const sitePath = (siteSlug: string, pageSlug = "") => `/s/${siteSlug}${pageSlug ? `/${pageSlug}` : ""}`;

/** Resolves a block link for the public site: site paths are prefixed with the site's base path. */
export function resolveHref(href: string, base: string): string | null {
  if (!href || !SAFE_HREF.test(href)) return null;
  if (href.startsWith("/")) return href === "/" ? base : `${base}${href}`;
  return href;
}

/** Plain-text outline of a page (AI tools, search). */
export function contentOutline(c: PageContent, max = 1200): string {
  const parts: string[] = [];
  for (const b of c.blocks) {
    switch (b.type) {
      case "hero":
        parts.push(`[hero] ${b.title}${b.subtitle ? ` — ${b.subtitle}` : ""}`);
        break;
      case "features":
        parts.push(`[features] ${b.title}: ${b.items.map((i) => i.title).join(", ")}`);
        break;
      case "richText":
        parts.push(`[text] ${b.body.replace(/\s+/g, " ").slice(0, 200)}`);
        break;
      case "cta":
        parts.push(`[cta] ${b.title}`);
        break;
      case "faq":
        parts.push(`[faq] ${b.items.length} questions`);
        break;
      case "testimonials":
        parts.push(`[testimonials] ${b.items.length}`);
        break;
      case "pricing":
        parts.push(`[pricing] ${b.items.length} products`);
        break;
      case "contactForm":
        parts.push(`[contact form] ${b.fields.map((f) => f.key).join(", ")}`);
        break;
      default:
        parts.push(`[${b.type}]`);
    }
  }
  return parts.join("\n").slice(0, max);
}
