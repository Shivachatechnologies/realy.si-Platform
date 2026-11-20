import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { moveStage, moveStageInput } from "@/server/modules/work/product-core";

type P = { orgId: string; companyId: string; productId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/stage", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => moveStage(ctx, orgId, companyId, productId, await body(req, moveStageInput)));

