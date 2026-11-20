import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { createDevelopmentProject } from "@/server/modules/work/product-core";

type P = { orgId: string; companyId: string; productId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/project", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, productId }) => createDevelopmentProject(ctx, orgId, companyId, productId));

