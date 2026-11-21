import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteFolder } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string; folderId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/creative/folders/:folderId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, folderId }) => deleteFolder(ctx, orgId, companyId, folderId));
