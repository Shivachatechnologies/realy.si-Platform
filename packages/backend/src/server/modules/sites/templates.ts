import { createTranslator, type Messages, type Translate } from "@/i18n/translate";
import { isAppLocale, type AppLocale } from "@/i18n/config";
import { blockSchema, newBlockId, pageContentSchema, pagePathSchema, type PageContent, type SiteBlock, type SitePageKind, type SiteTemplate } from "./schemas";

/**
 * Starter content for new sites (templates), the Founder Kit "website structure" → draft pages mapping, and the AI
 * section → block mapping. Copy comes from the site's locale (sites.tpl.* in the user catalogs, loadable by the worker)
 * and is clearly placeholder text the founder replaces: nothing claims customers, numbers or results.
 */

const LOADERS: Record<AppLocale, () => Promise<Messages>> = {
  "en-US": () => import("@/i18n/messages/en-US.json").then((m) => m.default as Messages),
  "hi-IN": () => import("@/i18n/messages/hi-IN.json").then((m) => m.default as Messages),
  "ar-AE": () => import("@/i18n/messages/ar-AE.json").then((m) => m.default as Messages),
  "de-DE": () => import("@/i18n/messages/de-DE.json").then((m) => m.default as Messages),
  "zh-CN": () => import("@/i18n/messages/zh-CN.json").then((m) => m.default as Messages),
};

export async function siteT(locale: string): Promise<Translate> {
  const l: AppLocale = isAppLocale(locale) ? locale : "en-US";
  return createTranslator(l, await LOADERS[l]());
}

export interface DraftPage {
  slug: string;
  title: string;
  kind: SitePageKind;
  showInNav: boolean;
  content: PageContent;
}

export interface TemplateInput {
  companyName: string;
  tagline?: string | null;
  description?: string | null;
  products: { id: string; name: string }[];
}

const b = (raw: Record<string, unknown>): SiteBlock => blockSchema.parse({ id: newBlockId(), ...raw });
const page = (slug: string, title: string, blocks: SiteBlock[], opts: { kind?: SitePageKind; showInNav?: boolean; description?: string } = {}): DraftPage => ({
  slug,
  title,
  kind: opts.kind ?? "PAGE",
  showInNav: opts.showInNav ?? true,
  content: pageContentSchema.parse({ title, seo: { title: title.slice(0, 70), description: (opts.description ?? "").slice(0, 170) }, blocks }),
});

export function contactBlock(t: Translate, companyName: string, title?: string): SiteBlock {
  return b({
    type: "contactForm",
    title: title ?? t("sites.tpl.contactTitle"),
    body: t("sites.tpl.contactBody"),
    fields: [
      { key: "name", required: true },
      { key: "email", required: true },
      { key: "company", required: false },
      { key: "message", required: true },
    ],
    submitLabel: t("sites.tpl.submit"),
    successMessage: t("sites.tpl.success"),
    consentText: t("sites.tpl.consent", { name: companyName }),
  });
}

export function pricingBlock(t: Translate, products: { id: string }[]): SiteBlock {
  return b({ type: "pricing", title: t("sites.tpl.pricingTitle"), subtitle: t("sites.tpl.pricingSubtitle"), items: products.slice(0, 6).map((p) => ({ productId: p.id, ctaLabel: t("sites.tpl.ctaContact"), ctaHref: "/contact" })) });
}

/** The pages a template starts with. */
export function templatePages(template: SiteTemplate, t: Translate, input: TemplateInput): DraftPage[] {
  const name = input.companyName;
  const subtitle = input.tagline || input.description || t("sites.tpl.heroSubtitle");
  const hero = (layout: "split" | "centered" = "split") =>
    b({ type: "hero", eyebrow: name, title: input.tagline ? name : t("sites.tpl.heroTitle", { name }), subtitle: subtitle.slice(0, 400), ctaLabel: t("sites.tpl.ctaContact"), ctaHref: "/contact", secondaryLabel: t("sites.tpl.ctaLearn"), secondaryHref: "#features", layout });
  const features = () =>
    b({
      id: "features",
      type: "features",
      title: t("sites.tpl.featuresTitle"),
      subtitle: t("sites.tpl.featuresSubtitle"),
      items: [
        { icon: "sparkles", title: t("sites.tpl.feature1"), body: t("sites.tpl.featureBody") },
        { icon: "shield", title: t("sites.tpl.feature2"), body: t("sites.tpl.featureBody") },
        { icon: "clock", title: t("sites.tpl.feature3"), body: t("sites.tpl.featureBody") },
      ],
    });
  const faq = () => b({ type: "faq", title: t("sites.tpl.faqTitle"), items: [{ q: t("sites.tpl.faqQ1"), a: t("sites.tpl.faqA") }, { q: t("sites.tpl.faqQ2"), a: t("sites.tpl.faqA") }] });
  const cta = () => b({ type: "cta", title: t("sites.tpl.ctaTitle"), body: t("sites.tpl.ctaBody"), ctaLabel: t("sites.tpl.ctaContact"), ctaHref: "/contact" });
  const about = () => page("about", t("sites.tpl.pageAbout"), [b({ type: "richText", body: t("sites.tpl.aboutBody", { name }) })]);
  const contact = () => page("contact", t("sites.tpl.pageContact"), [contactBlock(t, name)]);
  const home = (blocks: SiteBlock[]) => page("", t("sites.tpl.pageHome"), blocks, { description: subtitle });

  switch (template) {
    case "services":
      return [home([hero(), features(), cta()]), page("services", t("sites.tpl.pageServices"), [b({ type: "richText", body: t("sites.tpl.servicesBody") }), features(), cta()]), about(), contact()];
    case "product":
      return [
        home([hero(), features(), ...(input.products.length ? [pricingBlock(t, input.products)] : []), faq(), cta()]),
        ...(input.products.length ? [page("pricing", t("sites.tpl.pricingTitle"), [pricingBlock(t, input.products), faq()])] : []),
        about(),
        contact(),
      ];
    case "local":
      return [home([hero("centered"), features(), faq(), contactBlock(t, name)]), about()];
    case "landing":
      return [home([hero("centered"), features(), cta(), contactBlock(t, name)])];
  }
}

/** A standalone landing page (kind LANDING). */
export function landingPage(t: Translate, input: TemplateInput, slug: string, title: string): DraftPage {
  return page(
    slug,
    title,
    [
      b({ type: "hero", title, subtitle: t("sites.tpl.heroSubtitle"), ctaLabel: t("sites.tpl.ctaContact"), ctaHref: "#contact", layout: "centered" }),
      b({ type: "features", title: t("sites.tpl.featuresTitle"), items: [{ icon: "check", title: t("sites.tpl.feature1"), body: t("sites.tpl.featureBody") }, { icon: "check", title: t("sites.tpl.feature2"), body: t("sites.tpl.featureBody") }] }),
      { ...contactBlock(t, input.companyName), id: "contact" },
    ],
    { kind: "LANDING", showInNav: false },
  );
}

/** A blank page with a title block. */
export function blankPage(slug: string, title: string, kind: SitePageKind): DraftPage {
  return page(slug, title, [b({ type: "hero", title, layout: "centered" })], { kind, showInNav: kind === "PAGE" });
}

const normSlug = (raw: string): string | null => {
  const r = pagePathSchema.safeParse(raw.replace(/^\//, ""));
  return r.success ? r.data : null;
};

/** Founder Kit "website_structure" deliverable ({ pages: [{ slug, title, purpose, sections[] }] }) → draft pages. */
export function pagesFromStructure(
  t: Translate,
  input: TemplateInput,
  structure: { pages: { slug: string; title: string; purpose: string; sections: { heading: string; content: string }[] }[] },
): DraftPage[] {
  const out: DraftPage[] = [];
  const seen = new Set<string>();
  for (const p of structure.pages) {
    const slug = normSlug(p.slug);
    if (slug === null || seen.has(slug)) continue;
    seen.add(slug);
    const [first, ...rest] = p.sections;
    const blocks: SiteBlock[] = [];
    if (first) blocks.push(b({ type: "hero", eyebrow: slug ? "" : input.companyName, title: first.heading.slice(0, 160), subtitle: first.content.slice(0, 400), ctaLabel: t("sites.tpl.ctaContact"), ctaHref: "/contact", layout: slug ? "centered" : "split" }));
    for (const s of rest) blocks.push(b({ type: "richText", body: `## ${s.heading}\n\n${s.content}`.slice(0, 20_000) }));
    if (/pric/.test(slug) && input.products.length) blocks.push(pricingBlock(t, input.products));
    if (/contact|kontakt/.test(slug)) blocks.push(contactBlock(t, input.companyName));
    out.push(page(slug, p.title, blocks, { description: p.purpose }));
  }
  if (!seen.has("")) out.unshift(page("", t("sites.tpl.pageHome"), [b({ type: "hero", title: input.companyName, subtitle: input.tagline ?? t("sites.tpl.heroSubtitle"), layout: "centered" })]));
  return out;
}

// ───────────── AI sections (draft_site_pages tool) ─────────────

export const AI_SECTION_TYPES = ["hero", "features", "richText", "cta", "faq", "pricing", "contactForm"] as const;
export type AiSection = {
  type: (typeof AI_SECTION_TYPES)[number];
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  items?: { title: string; body?: string }[];
};

/** Model-friendly sections → validated blocks. Pricing uses the company's real products; testimonials are never AI-made. */
export function blocksFromSections(t: Translate, input: TemplateInput, sections: AiSection[]): SiteBlock[] {
  const out: SiteBlock[] = [];
  for (const s of sections) {
    const heading = (s.heading ?? "").slice(0, 160);
    const body = (s.body ?? "").slice(0, 400);
    const href = s.ctaHref && /^(\/(?!\/)[a-z0-9/#-]*|#[a-z0-9-]+)$/i.test(s.ctaHref) ? s.ctaHref : "/contact";
    switch (s.type) {
      case "hero":
        out.push(b({ type: "hero", title: heading, subtitle: body, ctaLabel: (s.ctaLabel ?? "").slice(0, 60), ctaHref: s.ctaLabel ? href : "", layout: out.length ? "centered" : "split" }));
        break;
      case "features":
        out.push(b({ type: "features", title: heading, subtitle: body, items: (s.items ?? []).slice(0, 12).map((i) => ({ title: i.title.slice(0, 120), body: (i.body ?? "").slice(0, 400) })) }));
        break;
      case "richText":
        out.push(b({ type: "richText", body: `${heading ? `## ${heading}\n\n` : ""}${(s.body ?? "").slice(0, 19_000)}` }));
        break;
      case "cta":
        out.push(b({ type: "cta", title: heading, body, ctaLabel: (s.ctaLabel ?? t("sites.tpl.ctaContact")).slice(0, 60), ctaHref: href }));
        break;
      case "faq":
        out.push(b({ type: "faq", title: heading, items: (s.items ?? []).slice(0, 30).map((i) => ({ q: i.title.slice(0, 300), a: (i.body ?? "").slice(0, 2000) })) }));
        break;
      case "pricing":
        if (input.products.length) out.push({ ...pricingBlock(t, input.products), ...(heading ? { title: heading } : {}) } as SiteBlock);
        break;
      case "contactForm":
        out.push({ ...contactBlock(t, input.companyName, heading || undefined) });
        break;
    }
  }
  return out.slice(0, 60);
}
