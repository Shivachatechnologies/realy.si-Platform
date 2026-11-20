import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { saveComposedDraft, saveComposedInput } from "@/server/modules/automation/compose";

type P = { orgId: string; companyId: string };

/** Save a composed definition as a DRAFT workflow (never published or activated here). */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/compose/save", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  saveComposedDraft(ctx, orgId, companyId, await body(req, saveComposedInput)),
);
