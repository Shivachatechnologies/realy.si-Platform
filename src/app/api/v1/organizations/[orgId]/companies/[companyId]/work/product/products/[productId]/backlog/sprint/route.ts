import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { pushFeatureToSprint, pushToSprintInput } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string; productId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/backlog/sprint", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => pushFeatureToSprint(ctx, orgId, companyId, productId, await body(req, pushToSprintInput)));

