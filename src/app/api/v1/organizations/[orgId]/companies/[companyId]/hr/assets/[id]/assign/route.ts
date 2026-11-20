import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assetAssignInput, assignAsset } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/assets/:id/assign", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => assignAsset(ctx, orgId, companyId, id, await body(req, assetAssignInput)));
