import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { autopilotPatch, getAutopilot, setAutopilotStatus, updateAutopilot } from "@/server/modules/crm/prospecting";

type P = { orgId: string; companyId: string; autopilotId: string };

/** GET one autopilot (funnel, people, runs); PATCH edits its settings; DELETE archives it (queued emails are cancelled). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, autopilotId }) => getAutopilot(ctx, orgId, companyId, autopilotId));

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/prospecting/:autopilotId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, autopilotId }) => updateAutopilot(ctx, orgId, companyId, autopilotId, (await body(req, autopilotPatch)) as z.input<typeof autopilotPatch>),
);

export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/prospecting/:autopilotId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, autopilotId }) => setAutopilotStatus(ctx, orgId, companyId, autopilotId, { status: "ARCHIVED" }),
);
