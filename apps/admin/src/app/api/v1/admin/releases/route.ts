import { route } from "@/server/core/http";
import { listReleases } from "@/server/modules/admin/releases";

/** Release history (app, environment, cursor) plus the release each app runs now. Read-only: no deploy or rollback. */
export const GET = route({ auth: "required", name: "GET /admin/releases" }, async ({ req, ctx }) => listReleases(ctx, Object.fromEntries(req.nextUrl.searchParams)));
