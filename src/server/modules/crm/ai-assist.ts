import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { createTask } from "@/server/modules/agents/service";
import { getAccount } from "./accounts";
import { getDeal } from "./deals";
import { listPipelines } from "./pipelines";
import { notFound } from "@/server/core/errors";

/**
 * AI Sales Workforce actions on CRM records: each creates an agent task linked to the record (subject) that runs under
 * the requester's permissions; proposed changes (stage moves, follow-ups) wait for approval.
 */

export const RECORD_AI_MODES = ["analyze", "next_action", "draft_follow_up"] as const;
export const recordAiInput = z.object({ mode: z.enum(RECORD_AI_MODES), guidance: z.string().trim().max(1000).optional() });
export const pipelineReviewInput = z.object({ pipelineId: z.string().uuid().optional(), guidance: z.string().trim().max(1000).optional() });

const guidanceLine = (g?: string) => (g ? `\n\nAdditional direction from the requester: ${g}` : "");

const DEAL: Record<(typeof RECORD_AI_MODES)[number], { title: string; text: (id: string) => string }> = {
  analyze: {
    title: "Deal analysis",
    text: (id) =>
      `Call read_deal with dealId ${id}, and read_account for its account if it has one. Write a deal analysis: (1) summary and current position, (2) stakeholders and engagement, (3) risks and red flags (stalled stage, missing next step, slipping close date, single-threaded), (4) a realistic win probability with reasoning compared to the recorded one, (5) what must happen to close.`,
  },
  next_action: {
    title: "Next best action",
    text: (id) =>
      `Call read_deal with dealId ${id}. Recommend the single next-best action with a concrete date, owner and rationale, plus two alternatives. If a follow-up is warranted, propose it with create_follow_up (subjectType "deal", subjectId ${id}); it is created only after approval.`,
  },
  draft_follow_up: {
    title: "Follow-up draft",
    text: (id) =>
      `Call read_deal with dealId ${id}. Draft a follow-up email to the deal's contact that fits the timeline and stage: subject line and plain-text body, concise and specific. This is a draft for a person to review and send — do not say it was sent.`,
  },
};

const ACCOUNT: Record<(typeof RECORD_AI_MODES)[number], { title: string; text: (id: string) => string }> = {
  analyze: {
    title: "Account analysis",
    text: (id) =>
      `Call read_account with accountId ${id} and read_deal for its open deals. Write an account analysis: relationship health, key contacts and gaps in coverage, open and past deals, risks, expansion/upsell opportunities, and sales intelligence from the Company Brain where relevant.`,
  },
  next_action: {
    title: "Next best action",
    text: (id) =>
      `Call read_account with accountId ${id}. Recommend the single next-best action for this account with a date and rationale, plus two alternatives. If a follow-up is warranted, propose it with create_follow_up (subjectType "account", subjectId ${id}); it is created only after approval.`,
  },
  draft_follow_up: {
    title: "Follow-up draft",
    text: (id) =>
      `Call read_account with accountId ${id}. Draft a follow-up email to the most relevant contact at this account based on recent activity and open deals: subject line and plain-text body. This is a draft for a person to review and send — do not say it was sent.`,
  },
};

export async function assistDeal(ctx: RequestContext, organizationId: string, companyId: string, dealId: string, raw: z.input<typeof recordAiInput>) {
  const input = recordAiInput.parse(raw);
  const deal = await getDeal(ctx, organizationId, companyId, dealId);
  const m = DEAL[input.mode];
  return createTask(ctx, organizationId, companyId, {
    profile: "account_executive",
    title: `${m.title}: ${deal.name}`.slice(0, 200),
    instructions: m.text(deal.id) + guidanceLine(input.guidance),
    subject: { type: "crm_deal", id: deal.id },
  });
}

export async function assistAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string, raw: z.input<typeof recordAiInput>) {
  const input = recordAiInput.parse(raw);
  const account = await getAccount(ctx, organizationId, companyId, accountId);
  const m = ACCOUNT[input.mode];
  return createTask(ctx, organizationId, companyId, {
    profile: "account_executive",
    title: `${m.title}: ${account.name}`.slice(0, 200),
    instructions: m.text(account.id) + guidanceLine(input.guidance),
    subject: { type: "account", id: account.id },
  });
}

/** AI pipeline review by the sales manager profile, linked to the pipeline. */
export async function pipelineReview(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof pipelineReviewInput>) {
  const input = pipelineReviewInput.parse(raw);
  const pipelines = await listPipelines(ctx, organizationId, companyId);
  const p = input.pipelineId ? pipelines.find((x) => x.id === input.pipelineId) : pipelines[0];
  if (!p) throw notFound("Pipeline");
  return createTask(ctx, organizationId, companyId, {
    profile: "sales_manager",
    title: `AI pipeline review: ${p.name}`.slice(0, 200),
    instructions:
      `Call read_pipeline_summary with pipelineId ${p.id}, then read_deals (status OPEN, and stale true) to inspect risky deals. Write a pipeline review: (1) pipeline health and coverage by stage, (2) forecast for the next three months (best case / commit / weighted) and its reliability, (3) stale, slipping or at-risk deals with the specific action for each, (4) owner-level observations and coaching points, (5) a recommended sales strategy for the coming month. Base every figure on tool results.` +
      guidanceLine(input.guidance),
    subject: { type: "crm_pipeline", id: p.id },
  });
}
