import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getEntry, saveDraft, saveDraftInput } from "@/server/modules/cms/service";

type P = { entryId: string };

export const GET = route<P>({ auth: "required", name: "GET /admin/cms/entries/:id" }, async ({ ctx }, { entryId }) => getEntry(ctx, entryId));

/** Save the draft (all locales, blocks, SEO). */
export const PUT = route<P>({ auth: "required", name: "PUT /admin/cms/entries/:id", rateLimits: LIMITS.admin, maxBodyBytes: 1_000_000 }, async ({ req, ctx }, { entryId }) =>
  saveDraft(ctx, entryId, await body(req, saveDraftInput)),
);
