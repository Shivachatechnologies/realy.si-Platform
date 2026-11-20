import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { docStatusInput, kindParam, setDocStatus } from "@/server/modules/work/product-docs";

type P = { orgId: string; companyId: string; productId: string; kind: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/products/:productId/docs/:kind/status", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, productId, kind }) => setDocStatus(ctx, orgId, companyId, productId, kindParam(kind), await body(req, docStatusInput)));

