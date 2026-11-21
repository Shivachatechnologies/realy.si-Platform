import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { crmMeetingInput, listCrmMeetings, scheduleMeeting } from "@/server/modules/crm/meetings";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listCrmMeetings(ctx, orgId, companyId, { upcoming: true }) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/meetings", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => scheduleMeeting(ctx, orgId, companyId, (await body(req, crmMeetingInput)) as z.input<typeof crmMeetingInput>),
);
