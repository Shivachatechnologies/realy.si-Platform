import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { kindParam, useAiDraft, useDraftInput } from "@/server/modules/work/product-docs";

type P = { orgId: string; companyId: string; productId: string; kind: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/docs/:kind/draft", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId, kind }) => useAiDraft(ctx, orgId, companyId, productId, kindParam(kind), await body(req, useDraftInput)));

