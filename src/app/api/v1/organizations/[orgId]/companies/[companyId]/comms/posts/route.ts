import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPost, listPosts, postInput } from "@/server/modules/comms/feed";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listPosts(ctx, orgId, companyId, { q: req.nextUrl.searchParams.get("q") ?? undefined, cursor: req.nextUrl.searchParams.get("cursor") ?? undefined }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/posts", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createPost(ctx, orgId, companyId, await body(req, postInput)),
);
