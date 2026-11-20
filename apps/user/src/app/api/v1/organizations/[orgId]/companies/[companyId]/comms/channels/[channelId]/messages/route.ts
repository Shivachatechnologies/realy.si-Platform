import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listMessages, messageInput, postMessage } from "@/server/modules/comms/channels";

type P = { orgId: string; companyId: string; channelId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, channelId }) => listMessages(ctx, orgId, companyId, channelId, { parentId: req.nextUrl.searchParams.get("parentId") ?? undefined, before: req.nextUrl.searchParams.get("before") ?? undefined }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/channels/:channelId/messages", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, channelId }) => postMessage(ctx, orgId, companyId, channelId, await body(req, messageInput)),
);
