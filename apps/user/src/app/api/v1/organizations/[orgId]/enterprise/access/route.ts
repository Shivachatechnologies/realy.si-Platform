import { route } from "@/server/core/http";
import { accessMatrix } from "@/server/modules/enterprise/roles";

/** Who has what: each member's permissions with the scopes and roles that grant them. */
export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ ctx }, { orgId }) => ({ data: await accessMatrix(ctx, orgId) }));
