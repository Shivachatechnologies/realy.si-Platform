import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { generateInput, generateWebsite } from "@/server/modules/sites/ai";

type P = { orgId: string; companyId: string };

/** "Generate my website": the web designer AI drafts pages (approval required; nothing is published). */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/sites/generate", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  generateWebsite(ctx, orgId, companyId, await body(req, generateInput)),
);
