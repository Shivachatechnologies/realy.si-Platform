import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listLibrary, parseLibraryFilters, uploadInput, uploadToLibrary } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listLibrary(ctx, orgId, companyId, parseLibraryFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/library", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 21 * 1024 * 1024 }, async ({ req, ctx }, { orgId, companyId }) => uploadToLibrary(ctx, orgId, companyId, await body(req, uploadInput)));
