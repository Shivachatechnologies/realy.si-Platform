import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { stopEnrollment } from "@/server/modules/marketing/sequences";

type P = { orgId: string; companyId: string; sequenceId: string; enrollmentId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId/enrollments/:enrollmentId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, sequenceId, enrollmentId }) => stopEnrollment(ctx, orgId, companyId, sequenceId, enrollmentId));
