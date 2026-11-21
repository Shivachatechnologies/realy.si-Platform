import { route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { bankFeed } from "@/server/modules/integrations/services/banking";

type P = { orgId: string; companyId: string; provider: string };

/** Linked banks, accounts with balances and the latest staged transactions (read-only bank feed). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, provider }) => {
  if (provider !== "plaid" && provider !== "wise") throw notFound("Integration");
  const take = Number(req.nextUrl.searchParams.get("take") ?? "50");
  return bankFeed(ctx, orgId, companyId, provider, Number.isFinite(take) ? take : 50);
});
