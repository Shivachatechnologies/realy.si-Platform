import { body, route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { updateSubmission, updateSubmissionInput } from "@/server/modules/sites/forms";

type P = { orgId: string; companyId: string; submissionId: string };

/** Mark a submission read / archived (or new again). */
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/sites/submissions/:submissionId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, submissionId }) =>
  updateSubmission(ctx, orgId, companyId, submissionId, await body(req, updateSubmissionInput)),
);
