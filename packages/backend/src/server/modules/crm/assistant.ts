import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { createTask } from "@/server/modules/agents/service";
import { getLead } from "./service";

/**
 * AI sales assistant: turns a request on a lead into an agent task for the sales researcher, linked to the lead. The task
 * runs under the requester's permissions and the profile's allow-list; sending email goes through send_lead_email, which
 * always needs a person's approval.
 */
export const ASSIST_MODES = ["brief", "draft", "send"] as const;
export const assistInput = z.object({
  mode: z.enum(ASSIST_MODES),
  /** Optional extra direction from the user ("mention the Q3 discount"). */
  guidance: z.string().trim().max(1000).optional(),
});

const INSTRUCTIONS: Record<(typeof ASSIST_MODES)[number], (leadId: string) => string> = {
  brief: (id) =>
    `Call read_lead with leadId ${id}. Then write a short brief: (1) a summary of the lead and the full interaction history so far, (2) where the deal stands and any risks, (3) the single best next action with a suggested date, and (4) two or three alternative actions. Base everything on the record; say when information is missing.`,
  draft: (id) =>
    `Call read_lead with leadId ${id}. Then draft a follow-up email to this lead that fits the history and the current stage: a subject line and a plain-text body, concise and specific. This is a draft for a person to review — do not call send_lead_email and do not say it was sent.`,
  send: (id) =>
    `Call read_lead with leadId ${id}. Draft a follow-up email that fits the history and the current stage, then propose sending it by calling send_lead_email with leadId ${id}, the subject and the plain-text body. A person must approve it before it is sent. In your deliverable, include the draft and state that it is awaiting approval — never that it was sent. If the lead has no email address, explain that instead of calling the tool.`,
};

const TITLES: Record<(typeof ASSIST_MODES)[number], string> = { brief: "Lead brief", draft: "Follow-up draft", send: "Follow-up email (approval)" };

export async function assistLead(ctx: RequestContext, organizationId: string, companyId: string, leadId: string, raw: z.input<typeof assistInput>) {
  const input = assistInput.parse(raw);
  const lead = await getLead(ctx, organizationId, companyId, leadId);
  const instructions = [INSTRUCTIONS[input.mode](lead.id), input.guidance ? `Additional direction from the requester: ${input.guidance}` : null].filter(Boolean).join("\n\n");
  return createTask(ctx, organizationId, companyId, {
    profile: "sales_researcher",
    title: `${TITLES[input.mode]}: ${lead.name}`.slice(0, 200),
    instructions,
    leadId: lead.id,
  });
}
