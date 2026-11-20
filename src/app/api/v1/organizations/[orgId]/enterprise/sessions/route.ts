import { route } from "@/server/core/http";
import { listMemberSessions } from "@/server/modules/enterprise/policy";

export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ ctx }, { orgId }) => ({
  data: await listMemberSessions(ctx, orgId),
}));
