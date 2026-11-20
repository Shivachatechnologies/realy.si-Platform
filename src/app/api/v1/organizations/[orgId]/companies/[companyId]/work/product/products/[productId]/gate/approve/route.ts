import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { approveGate } from "@/server/modules/work/product-core";
import { z } from "zod";

const approveInput = z.object({ approve: z.boolean().default(true) });

type P = { orgId: string; companyId: string; productId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/gate/approve", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => approveGate(ctx, orgId, companyId, productId, (await body(req, approveInput)).approve ?? true));

