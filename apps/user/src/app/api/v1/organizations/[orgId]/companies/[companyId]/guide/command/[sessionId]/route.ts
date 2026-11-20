import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteCommandSession, getCommandSession } from "@/server/modules/guide/command";

type P = { orgId: string; companyId: string; sessionId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, sessionId }) => getCommandSession(ctx, orgId, companyId, sessionId));
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/guide/command/:sessionId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, sessionId }) => deleteCommandSession(ctx, orgId, companyId, sessionId),
);
