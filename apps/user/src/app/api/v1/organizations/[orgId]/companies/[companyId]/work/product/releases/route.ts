import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createRelease, listReleases, releaseInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listReleases(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/releases", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createRelease(ctx, orgId, companyId, await body(req, releaseInput)));
