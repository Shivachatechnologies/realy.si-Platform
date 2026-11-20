import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { itemAction, itemActionInput } from "@/server/modules/marketing/autopilot";

type P = { orgId: string; companyId: string; itemId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/autopilot-items/:itemId/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, itemId }) => itemAction(ctx, orgId, companyId, itemId, await body(req, itemActionInput)));
