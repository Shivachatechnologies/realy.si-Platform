import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createOutreachDraft, listOutreach, outreachDraftInput, OUTREACH_STATUSES } from "@/server/modules/crm/outreach";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const s = req.nextUrl.searchParams.get("status");
  const status = (OUTREACH_STATUSES as readonly string[]).includes(s ?? "") ? (s as (typeof OUTREACH_STATUSES)[number]) : undefined;
  return { data: await listOutreach(ctx, orgId, companyId, { status }) };
});

/** Save an email a person wrote (optionally straight into the approval queue). Nothing is sent. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/outreach", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createOutreachDraft(ctx, orgId, companyId, (await body(req, outreachDraftInput)) as z.input<typeof outreachDraftInput>),
);
