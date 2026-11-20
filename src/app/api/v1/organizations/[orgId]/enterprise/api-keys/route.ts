import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createApiKey, createApiKeyInput, listApiKeys } from "@/server/modules/enterprise/api-keys";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => ({ data: await listApiKeys(ctx, orgId) }));
/** Returns the secret once; it cannot be retrieved again. Not idempotent-replayable on purpose (the secret is never stored). */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/enterprise/api-keys",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => {
    const created = await createApiKey(ctx, orgId, await body(req, createApiKeyInput));
    return new Response(JSON.stringify(created), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  },
);
