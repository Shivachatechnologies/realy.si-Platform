import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { commandInput, commandSuggestions, listCommandSessions, runCommand } from "@/server/modules/guide/command";

type P = { orgId: string; companyId: string };

/** GET — the viewer's command history and suggested commands. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({
  data: await listCommandSessions(ctx, orgId, companyId),
  ...(await commandSuggestions(ctx, orgId, companyId)),
}));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/command", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => runCommand(ctx, orgId, companyId, await body(req, commandInput)),
);
