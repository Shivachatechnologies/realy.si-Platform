import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { stopEnrollment } from "@/server/modules/crm/cadences";

type P = { orgId: string; companyId: string; enrollmentId: string };

/** DELETE takes a person out of a sequence (pending sequence emails are cancelled). */
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/enrollments/:enrollmentId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, enrollmentId }) => stopEnrollment(ctx, orgId, companyId, enrollmentId));
