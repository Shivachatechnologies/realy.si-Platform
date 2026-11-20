import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { kindParam, restoreDocVersion } from "@/server/modules/work/product-docs";
import { z } from "zod";

const restoreInput = z.object({ version: z.number().int().min(1) });

type P = { orgId: string; companyId: string; productId: string; kind: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/docs/:kind/restore", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId, kind }) => restoreDocVersion(ctx, orgId, companyId, productId, kindParam(kind), (await body(req, restoreInput)).version));

