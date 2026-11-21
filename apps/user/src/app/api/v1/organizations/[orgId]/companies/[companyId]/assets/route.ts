import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { generateAssets, generateInput, listAssets } from "@/server/modules/assets/service";

type P = { orgId: string; companyId: string };

/** GET ?scopeType=&scopeId=&q=&cursor=&limit= — the company's visual assets, newest first. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listAssets(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));

/** POST — generate artwork with the connected image provider (OpenAI → Stability → Replicate). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/assets", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => generateAssets(ctx, orgId, companyId, await body(req, generateInput)),
);
