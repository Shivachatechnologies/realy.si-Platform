import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { db } from "@/server/core/db";
import { authorize } from "./common";
import { latestStructure, upsertDraftPages } from "./service";
import { contentOutline, pageContentSchema, pagePathSchema, readContent, readNav, readTheme } from "./schemas";
import { AI_SECTION_TYPES, blocksFromSections, siteT, type DraftPage } from "./templates";

/** AI tools of the sites module, registered in src/server/modules/tools/modules.ts. */

const section = z
  .object({
    type: z.enum(AI_SECTION_TYPES),
    heading: z.string().trim().max(160).optional(),
    body: z.string().trim().max(19_000).optional(),
    ctaLabel: z.string().trim().max(60).optional(),
    ctaHref: z.string().trim().max(200).optional(),
    items: z.array(z.object({ title: z.string().trim().min(1).max(300), body: z.string().trim().max(2000).optional() }).strict()).max(30).optional(),
  })
  .strict();
const draftInput = z
  .object({
    pages: z
      .array(
        z
          .object({
            slug: z.string().trim().max(120),
            title: z.string().trim().min(1).max(160),
            kind: z.enum(["PAGE", "LANDING"]).optional(),
            description: z.string().trim().max(170).optional(),
            sections: z.array(section).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

export const SITES_TOOLS: Record<string, ToolDefinition> = {
  read_site: def({
    name: "read_site",
    version: 1,
    description:
      "Returns the company's website: name, address, language, theme, navigation, every page (path, kind, status, outline of its draft), the company's products (for pricing sections) and the Founder Kit website structure when one is ready. Read it before drafting pages.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read the company website",
    async execute(_input, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "marketing.read");
      const site = await db().site.findFirst({ where: { organizationId, companyId } });
      if (!site) return { content: "The company has no website yet. A person creates it under Website; you can draft pages once it exists." };
      const [pages, products, structure] = await Promise.all([
        db().sitePage.findMany({ where: { siteId: site.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 60 }),
        db().product.findMany({ where: { organizationId, companyId, archivedAt: null }, take: 50, select: { id: true, name: true, description: true } }),
        latestStructure(organizationId, companyId),
      ]);
      const theme = readTheme(site.theme);
      const lines = [
        `Website "${site.name}" at /s/${site.slug} (language ${site.locale}, ${site.online ? "online" : "offline"}). Theme: brand colour ${theme.brandColor}, font ${theme.font}, style ${theme.style}.`,
        `Navigation: ${readNav(site.nav).map((n) => `${n.label} → ${n.href}`).join(", ") || "none"}`,
        "Pages:",
        ...(pages.length ? pages.map((p) => `- /${p.slug} "${p.title}" [${p.kind}, ${p.status}]\n${contentOutline(readContent(p.draft), 600).replace(/^/gm, "    ")}`) : ["- none"]),
        `Products: ${products.map((p) => `${p.name}${p.description ? ` — ${p.description.slice(0, 160)}` : ""}`).join("; ") || "none recorded"}`,
        structure
          ? `Founder Kit website structure:\n${structure.pages.map((p) => `- ${p.slug} "${p.title}": ${p.purpose}\n${p.sections.map((s) => `    • ${s.heading}: ${s.content.slice(0, 300)}`).join("\n")}`).join("\n")}`
          : "Founder Kit website structure: not available.",
      ];
      return { content: lines.join("\n").slice(0, 24_000), records: [`site:${site.id}`, ...pages.map((p) => `site_page:${p.id}`)], count: pages.length };
    },
  }),

  draft_site_pages: def({
    name: "draft_site_pages",
    version: 1,
    description:
      "Propose website pages as DRAFTS (a person approves first; nothing is published). Each page has a path (\"\" or \"/\" for the home page, e.g. \"about\", \"services\", \"contact\"), a title, an optional SEO description and sections. Section types: hero (heading, body, ctaLabel, ctaHref), features (heading, body, items with title/body), richText (heading, body with ## headings and - lists), cta (heading, body, ctaLabel, ctaHref), faq (heading, items with title = question, body = answer), pricing (lists the company's real products), contactForm (heading). Existing pages get a new draft; their live version stays until a person publishes.",
    input: draftInput,
    modelSchema: {
      type: "object",
      properties: {
        pages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string", description: 'Page path, "" for the home page' },
              title: { type: "string" },
              kind: { type: "string", enum: ["PAGE", "LANDING"] },
              description: { type: "string", description: "SEO description, at most 170 characters" },
              sections: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: [...AI_SECTION_TYPES] },
                    heading: { type: "string" },
                    body: { type: "string" },
                    ctaLabel: { type: "string" },
                    ctaHref: { type: "string", description: 'Site path like "/contact" or an anchor like "#contact"' },
                    items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"], additionalProperties: false } },
                  },
                  required: ["type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["slug", "title", "sections"],
            additionalProperties: false,
          },
        },
      },
      required: ["pages"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    actionClass: "change_data",
    timeoutMs: 30_000,
    summarize: ({ pages }) => `Save ${pages.length} draft website page${pages.length === 1 ? "" : "s"} (${pages.map((p) => p.title).join(", ").slice(0, 160)})`,
    async execute(input, { ctx, organizationId, companyId }) {
      const site = await db().site.findFirst({ where: { organizationId, companyId }, select: { name: true, locale: true } });
      if (!site) return { content: "The company has no website yet; nothing was saved." };
      const products = await db().product.findMany({ where: { organizationId, companyId, archivedAt: null }, take: 6, select: { id: true, name: true } });
      const t = await siteT(site.locale);
      const ti = { companyName: site.name, products };
      const drafts: DraftPage[] = [];
      const seen = new Set<string>();
      for (const p of input.pages) {
        const slug = pagePathSchema.safeParse(p.slug === "/" ? "" : p.slug);
        if (!slug.success || seen.has(slug.data)) continue;
        seen.add(slug.data);
        const blocks = blocksFromSections(t, ti, p.sections);
        if (!blocks.length) continue;
        const kind = p.kind ?? "PAGE";
        drafts.push({ slug: slug.data, title: p.title, kind, showInNav: kind === "PAGE", content: pageContentSchema.parse({ title: p.title, seo: { title: p.title.slice(0, 70), description: p.description ?? "" }, blocks }) });
      }
      if (!drafts.length) return { content: "No valid pages were given; nothing was saved." };
      const r = await upsertDraftPages(ctx, organizationId, companyId, drafts);
      return {
        content: `Saved ${r.pages.length} draft page(s) on /s/${r.siteSlug}: ${r.pages.map((p) => `/${p.slug} (${p.created ? "new" : "new draft"})`).join(", ")}. They are drafts: a person reviews and publishes them under Website.`,
        records: r.pages.map((p) => `site_page:${p.id}`),
        count: r.pages.length,
      };
    },
  }),
};
