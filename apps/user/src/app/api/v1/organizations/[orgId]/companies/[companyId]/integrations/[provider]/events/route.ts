import { route } from "@/server/core/http";
import { authorizeIntegrations } from "@/server/modules/integrations/service";
import { listProviderEventsFor } from "@/server/modules/integrations/provider-webhooks";

type P = { orgId: string; companyId: string; provider: string };

/** Webhooks / status callbacks the provider sent for this connection (summaries only), newest first. Query: cursor. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, provider }) => {
  await authorizeIntegrations(ctx, orgId, companyId, "integrations.read");
  return listProviderEventsFor(orgId, companyId, provider, req.nextUrl.searchParams.get("cursor") ?? undefined);
});
