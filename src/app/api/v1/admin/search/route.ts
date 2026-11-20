import { route } from "@/server/core/http";
import { adminSearch } from "@/server/modules/admin/search";

export const GET = route({ auth: "required", name: "GET /admin/search" }, async ({ req, ctx }) => adminSearch(ctx, req.nextUrl.searchParams.get("q") ?? ""));
