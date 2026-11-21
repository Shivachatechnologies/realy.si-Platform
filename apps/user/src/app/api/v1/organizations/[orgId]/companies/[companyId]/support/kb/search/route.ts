import { route } from "@/server/core/http";
import { searchArticles } from "@/server/modules/support/kb";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: (await searchArticles(ctx, orgId, companyId, req.nextUrl.searchParams.get("q") ?? "", { limit: 6 })).map((a) => ({ id: a.id, title: a.title, slug: a.slug, status: a.status, excerpt: a.excerpt })) }));
