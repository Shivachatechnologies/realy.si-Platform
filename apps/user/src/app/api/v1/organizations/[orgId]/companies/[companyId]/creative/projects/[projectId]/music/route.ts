import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { musicInput, musicSearch, setMusic } from "@/server/modules/creative/pipeline";

type P = { orgId: string; companyId: string; projectId: string };
/** GET ?q= — tracks from the connected licensed music source (commercial-use licenses only). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => musicSearch(ctx, orgId, companyId, (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100)));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/projects/:projectId/music", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 28 * 1024 * 1024 }, async ({ req, ctx }, { orgId, companyId, projectId }) => setMusic(ctx, orgId, companyId, projectId, await body(req, musicInput)));
