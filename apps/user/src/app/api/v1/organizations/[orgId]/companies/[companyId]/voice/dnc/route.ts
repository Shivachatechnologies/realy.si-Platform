import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addDoNotCall, dncInput, listDoNotCall } from "@/server/modules/voice/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listDoNotCall(ctx, orgId, companyId, { q: req.nextUrl.searchParams.get("q") ?? undefined }) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/dnc", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => addDoNotCall(ctx, orgId, companyId, await body(req, dncInput)),
);
