import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { z } from "zod";
import { setFollowUpDone } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string; taskId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/follow-ups/:taskId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, ticketId, taskId }) => setFollowUpDone(ctx, orgId, companyId, ticketId, taskId, (await body(req, z.object({ done: z.boolean() }))).done),
);
