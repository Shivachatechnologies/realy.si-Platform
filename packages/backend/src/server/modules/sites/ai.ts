import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { createTask, listSubjectTasks } from "@/server/modules/agents/service";
import { assertFeature } from "@/server/modules/entitlements/service";
import { authorize } from "./common";

/**
 * "Generate my website": an AI task for the web designer profile. It reads the company brain, brand kit, products and
 * the Founder Kit website structure, then proposes DRAFT pages with draft_site_pages (SUPERVISED: a person approves
 * the drafts, and publishing stays a separate human step).
 */

export const SITE_SUBJECT = "site";
export const generateInput = z.object({
  brief: z.string().trim().max(2000).optional(),
  /** Restrict the draft to these page paths (e.g. one landing page). */
  focus: z.string().trim().max(300).optional(),
});

export async function generateWebsite(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof generateInput> = {}) {
  const input = generateInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  await assertFeature(ctx, organizationId, "feature.website_builder");
  const site = await db().site.findFirst({ where: { organizationId, companyId }, select: { id: true, name: true, locale: true } });
  if (!site) throw notFound("Website");
  const instructions = [
    `Draft the website "${site.name}" for this company. Write every page in the site's language (${site.locale}).`,
    "1. Call read_site to see the current pages, the Founder Kit website structure (if any) and the company's products.",
    "2. Call read_brand_kit and search_company_brain for the offer, audience, voice and real facts. Use read_company_graph for products and services.",
    "3. Call draft_site_pages once with all pages: follow the Founder Kit structure when there is one; otherwise a home page plus the 3 to 6 pages the business needs (e.g. services, about, pricing, contact). Every site needs a contact form.",
    "Rules: never invent customers, testimonials, numbers, awards or results; when a fact is missing, write neutral copy the founder can complete. Pricing sections only list the company's real products. Pages stay drafts — you cannot publish.",
    input.focus ? `Focus only on: ${input.focus}` : null,
    input.brief ? `Founder's brief: ${input.brief}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const task = await createTask(ctx, organizationId, companyId, { profile: "web_designer", title: `Draft the website ${site.name}`.slice(0, 200), instructions, subject: { type: SITE_SUBJECT, id: site.id } });
  return { taskId: task.id };
}

export async function siteTasks(ctx: RequestContext, organizationId: string, companyId: string, siteId: string) {
  return listSubjectTasks(ctx, organizationId, companyId, SITE_SUBJECT, siteId, 5).catch(() => []);
}
