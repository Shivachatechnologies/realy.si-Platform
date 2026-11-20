import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { channelInput, createChannel, listChannels } from "@/server/modules/comms/channels";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listChannels(ctx, orgId, companyId, { q: req.nextUrl.searchParams.get("q") ?? undefined, direct: req.nextUrl.searchParams.get("direct") === "1", archived: req.nextUrl.searchParams.get("archived") === "1" }) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/channels", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createChannel(ctx, orgId, companyId, await body(req, channelInput)),
);
