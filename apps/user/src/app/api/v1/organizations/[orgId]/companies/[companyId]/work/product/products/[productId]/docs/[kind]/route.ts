import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { docVersionInput, getDoc, kindParam, saveDocVersion } from "@/server/modules/work/product-docs";

type P = { orgId: string; companyId: string; productId: string; kind: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, productId, kind }) => getDoc(ctx, orgId, companyId, productId, kindParam(kind), Number(req.nextUrl.searchParams.get("version")) || undefined));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/docs/:kind", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId, kind }) => saveDocVersion(ctx, orgId, companyId, productId, kindParam(kind), await body(req, docVersionInput)));

