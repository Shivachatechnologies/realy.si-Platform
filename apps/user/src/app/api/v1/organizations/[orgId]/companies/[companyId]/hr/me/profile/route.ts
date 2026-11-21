import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { selfPatch, updateMyProfile } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/me/profile", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId }) => updateMyProfile(ctx, orgId, companyId, await body(req, selfPatch)));
