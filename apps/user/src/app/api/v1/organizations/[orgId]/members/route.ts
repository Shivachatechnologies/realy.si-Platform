import { route } from "@/server/core/http";
import { listMembers } from "@/server/modules/organizations/service";

export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ ctx }, { orgId }) => ({ data: await listMembers(ctx, orgId) }));
