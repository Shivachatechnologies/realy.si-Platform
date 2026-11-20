import { z } from "zod";
import type { MarketingContentType } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { actorId, authorize, isUuid } from "./common";
import { CONTENT_TYPES } from "./content";
import { extractJson } from "./ai";
import { brandContextFor } from "./brand";
import { learningsContext } from "./learning";

/** Content Factory: one source item → a multi-platform campaign bundle of linked child items. */
export const DEFAULT_BUNDLE: MarketingContentType[] = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "THREADS", "TIKTOK_SCRIPT", "YOUTUBE_SCRIPT", "CAROUSEL", "BLOG", "NEWSLETTER", "QUOTE", "GRAPHIC_BRIEF"];

export const repurposeInput = z.object({
  formats: z.array(z.enum(CONTENT_TYPES)).min(1).max(20).default(DEFAULT_BUNDLE),
  /** Variations per format (A/B copy). */
  variations: z.number().int().min(1).max(3).default(1),
  note: z.string().trim().max(2000).optional(),
});
export const applyRepurposeInput = z.object({ taskId: z.string().uuid() });

const GUIDE: Partial<Record<MarketingContentType, string>> = {
  LINKEDIN: "LinkedIn post, ≤ 3000 chars, hook first line, short paragraphs, 3-5 hashtags",
  X: "X post ≤ 270 chars (or a thread: posts separated by a line with ---)",
  INSTAGRAM: "Instagram caption ≤ 2200 chars with up to 15 hashtags",
  FACEBOOK: "Facebook post, conversational",
  THREADS: "Threads post ≤ 500 chars",
  TIKTOK_SCRIPT: "TikTok/Reel script 20-45 s: hook, scenes with on-screen text and voice-over, CTA",
  YOUTUBE_SCRIPT: "YouTube video: title (≤ 100 chars), description, chapters and full script",
  VIDEO_SCRIPT: "short video script with scenes",
  CAROUSEL: "carousel: 6-10 slides, one line headline + one supporting sentence per slide",
  BLOG: "blog post in Markdown with H2/H3 headings",
  SEO_ARTICLE: "long-form SEO article in Markdown",
  NEWSLETTER: "newsletter issue: subject line, preheader and body",
  EMAIL: "marketing email: subject line and body",
  QUOTE: "3-5 pull quotes suitable for quote graphics",
  GRAPHIC_BRIEF: "graphics brief: concept, layout, text overlay, colors from the brand kit, dimensions per platform",
  AD: "ad copy: 3 headlines (≤ 40 chars), 2 primary texts, CTA",
  LANDING_PAGE: "landing page copy: hero, benefits, social proof placeholders, FAQ, CTA",
  PRESS_RELEASE: "press release with headline, dateline, body, boilerplate",
  CASE_STUDY: "case study: challenge, solution, results (only real data)",
};

export async function requestRepurpose(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof repurposeInput>) {
  const input = repurposeInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(contentId)) throw notFound("Content");
  const c = await db().marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
  if (!c) throw notFound("Content");
  if (!c.body.trim()) throw invalid("Write the source content first", { reason: "marketing_content_empty" });
  const formats = [...new Set(input.formats)].filter((f) => f !== c.type || input.formats.length === 1);
  const instructions = [
    `Repurpose the source content below into a multi-platform campaign bundle. Produce ${input.variations > 1 ? `${input.variations} distinct variations of ` : ""}each of these formats:`,
    ...formats.map((f) => `- ${f}: ${GUIDE[f] ?? f.toLowerCase().replace(/_/g, " ")}`),
    "Keep every claim faithful to the source and the company's documents; do not invent numbers, customers or results.",
    `Return ONLY a JSON object, no prose: {"items": [{"type": one of ${JSON.stringify(formats)}, "title": string (internal title, ≤ 120 chars), "body": string (the finished content), "brief": string (one line: purpose / platform notes)}]}`,
    `Source (${c.type}) "${c.title}":\n"""\n${c.body.slice(0, 6000)}\n"""`,
    input.note ? `Direction from the team: ${input.note}` : "",
    await brandContextFor(companyId),
    await learningsContext(companyId),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
  return createTask(ctx, organizationId, companyId, { profile: "content_strategist", title: `Repurpose: ${c.title}`.slice(0, 200), instructions, subject: { type: "marketing_content", id: c.id } });
}

/** Create the bundle's child items from a completed repurpose task (linked to the source via parentId). */
export async function applyRepurpose(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof applyRepurposeInput>) {
  const { taskId } = applyRepurposeInput.parse(raw);
  const task = await getTask(ctx, organizationId, companyId, taskId);
  if (task.subjectType !== "marketing_content" || task.subjectId !== contentId) throw notFound("Task");
  if (task.status !== "COMPLETED" || !task.output) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
  const parsed = z
    .object({ items: z.array(z.object({ type: z.enum(CONTENT_TYPES), title: z.string().trim().min(1).max(250), body: z.string().trim().min(1).max(100_000), brief: z.string().max(5000).optional() })).min(1).max(60) })
    .safeParse(extractJson(task.output));
  if (!parsed.success) throw invalid("The AI output could not be read", { reason: "marketing_ai_output_unparseable" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const source = await tx.marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
    if (!source) throw notFound("Content");
    const already = await tx.marketingContentVersion.findFirst({ where: { companyId, source: `repurpose:${taskId}` }, select: { id: true } });
    if (already) throw conflict("This bundle was already created", { reason: "marketing_bundle_exists" });
    const by = actorId(ctx, organizationId);
    const ids: string[] = [];
    for (const it of parsed.data.items) {
      const child = await tx.marketingContent.create({
        data: { organizationId, companyId, type: it.type, title: it.title, body: it.body, brief: it.brief ?? `Repurposed from "${source.title}"`, campaignId: source.campaignId, parentId: source.id, keywords: source.keywords, createdById: by },
      });
      await tx.marketingContentVersion.create({ data: { organizationId, companyId, contentId: child.id, version: 1, title: child.title, body: child.body, source: `repurpose:${taskId}`, createdById: by } });
      ids.push(child.id);
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.repurposed", resourceType: "marketing_content", resourceId: source.id, newValue: { taskId, children: ids.length } });
    return { created: ids.length, ids };
  });
}
