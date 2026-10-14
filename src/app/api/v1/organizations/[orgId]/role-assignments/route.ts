import { body, route } from "@/server/core/http";
import { assignRole, assignRoleInput } from "@/server/modules/rbac/service";

export const POST = route<{ orgId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId }) => assignRole(ctx, orgId, await body(req, assignRoleInput)));
