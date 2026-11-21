import { z } from "zod";
import { route } from "@/server/core/http";
import { LINK_SUBJECTS, relatedKnowledge } from "@/server/modules/brain/links";

type P = { orgId: string; companyId: string };
const query = z.object({ subjectType: z.enum(LINK_SUBJECTS), subjectId: z.string().uuid() });

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return relatedKnowledge(ctx, orgId, companyId, q.subjectType, q.subjectId);
});
