import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { brandKitInput, deleteBrandKit, getBrandKit, saveBrandKit } from "@/server/modules/marketing/brand";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await getBrandKit(ctx, orgId, companyId) }));
export const PUT = route<P>({ auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/marketing/brand", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => saveBrandKit(ctx, orgId, companyId, await body(req, brandKitInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/brand", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId }) => deleteBrandKit(ctx, orgId, companyId));
