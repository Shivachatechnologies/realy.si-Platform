import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getProduct, updateProduct, updateProductInput } from "@/server/modules/work/product-core";

type P = { orgId: string; companyId: string; productId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, productId }) => getProduct(ctx, orgId, companyId, productId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/products/:productId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, productId }) => updateProduct(ctx, orgId, companyId, productId, await body(req, updateProductInput)));

