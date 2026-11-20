import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { COMMENT_SUBJECTS, commentInput, createComment, listComments, type CommentSubject } from "@/server/modules/comms/feed";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: (COMMENT_SUBJECTS as readonly string[]).includes(req.nextUrl.searchParams.get("subjectType") ?? "") ? await listComments(ctx, orgId, companyId, req.nextUrl.searchParams.get("subjectType") as CommentSubject, req.nextUrl.searchParams.get("subjectId") ?? "") : [] }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/comments", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createComment(ctx, orgId, companyId, await body(req, commentInput)),
);
