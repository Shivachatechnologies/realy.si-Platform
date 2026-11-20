import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { AppError } from "@/server/core/errors";
import { addCrmActivity, crmActivityInput, SUBJECT_TYPES, subjectWorkspace, type SubjectType } from "@/server/modules/crm/activities";

type P = { orgId: string; companyId: string };

/** GET ?subjectType=contact|account|deal&subjectId= — timeline, follow-ups and attachments. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const type = req.nextUrl.searchParams.get("subjectType") ?? "";
  if (!(SUBJECT_TYPES as readonly string[]).includes(type)) throw new AppError("validation_error", "subjectType must be contact, account or deal");
  return subjectWorkspace(ctx, orgId, companyId, type as SubjectType, req.nextUrl.searchParams.get("subjectId") ?? "");
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/activities", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => addCrmActivity(ctx, orgId, companyId, await body(req, crmActivityInput)),
);
