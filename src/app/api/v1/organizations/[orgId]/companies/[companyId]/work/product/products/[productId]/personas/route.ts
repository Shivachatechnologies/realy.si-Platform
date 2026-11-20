import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPersona, getResearch, personaInput } from "@/server/modules/work/product-research";

type P = { orgId: string; companyId: string; productId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, productId }) => getResearch(ctx, orgId, companyId, productId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/personas", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => createPersona(ctx, orgId, companyId, productId, await body(req, personaInput)));

