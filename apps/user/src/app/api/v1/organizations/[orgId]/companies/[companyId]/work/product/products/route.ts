import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProduct, listProducts, parseProductFilters, productInput } from "@/server/modules/work/product-core";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listProducts(ctx, orgId, companyId, parseProductFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createProduct(ctx, orgId, companyId, await body(req, productInput)));

