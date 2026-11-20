import { route } from "@/server/core/http";
import { usageAnalytics } from "@/server/modules/enterprise/insights";

export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ ctx }, { orgId }) => usageAnalytics(ctx, orgId));
