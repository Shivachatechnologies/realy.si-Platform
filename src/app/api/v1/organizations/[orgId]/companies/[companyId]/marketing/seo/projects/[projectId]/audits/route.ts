import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { auditInput, runAudit } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string; projectId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/seo/projects/:projectId/audits", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => runAudit(ctx, orgId, companyId, projectId, await body(req, auditInput)));
