import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { autopilotInput, companyFunnel, createAutopilot, listAutopilots } from "@/server/modules/crm/prospecting";

type P = { orgId: string; companyId: string };

/** GET the prospecting autopilots with their funnels (+ the company-wide funnel); POST creates one (it starts off). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listAutopilots(ctx, orgId, companyId), funnel: await companyFunnel(ctx, orgId, companyId) }));

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/prospecting", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createAutopilot(ctx, orgId, companyId, (await body(req, autopilotInput)) as z.input<typeof autopilotInput>),
);
