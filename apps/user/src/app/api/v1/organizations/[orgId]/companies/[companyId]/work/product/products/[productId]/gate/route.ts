import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addGateItem, gateItemInput, gateUpdateInput, updateGate } from "@/server/modules/work/product-core";

type P = { orgId: string; companyId: string; productId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/products/:productId/gate", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, productId }) => updateGate(ctx, orgId, companyId, productId, await body(req, gateUpdateInput)));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/gate", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => addGateItem(ctx, orgId, companyId, productId, await body(req, gateItemInput)));

