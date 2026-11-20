import { route } from "@/server/core/http";
import { listIntegrations } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listIntegrations(ctx, orgId, companyId) }));
