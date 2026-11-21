import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiOutreachDraft, outreachAiInput } from "@/server/modules/crm/outreach";

type P = { orgId: string; companyId: string };

/** AI drafts an email (connected OpenAI / Gemini) and saves it as a draft for review. Nothing is sent. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/outreach/ai", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => aiOutreachDraft(ctx, orgId, companyId, (await body(req, outreachAiInput)) as z.input<typeof outreachAiInput>),
);
