import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { MAX_DOCUMENT_BYTES, documentInput, uploadDocument } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/employees/:id/documents", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 64 * 1024 }, async ({ req, ctx }, { orgId, companyId, id }) => uploadDocument(ctx, orgId, companyId, id, await body(req, documentInput)));
