import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createEntry, createEntryInput, listEntries } from "@/server/modules/cms/service";

export const GET = route({ auth: "required", name: "GET /admin/cms/entries" }, async ({ req, ctx }) => listEntries(ctx, Object.fromEntries(req.nextUrl.searchParams)));

export const POST = route({ auth: "required", name: "POST /admin/cms/entries", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => createEntry(ctx, await body(req, createEntryInput)));
