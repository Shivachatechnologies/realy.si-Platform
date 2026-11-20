import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { ENTRY_ACTIONS, entryAction, entryActionInput, type EntryAction } from "@/server/modules/cms/service";

/** publish | schedule | unpublish | archive | restore | rollback */
export const POST = route<{ entryId: string; action: string }>(
  { auth: "required", name: "POST /admin/cms/entries/:id/:action", rateLimits: LIMITS.admin, idempotent: true },
  async ({ req, ctx }, { entryId, action }) => {
    if (!(ENTRY_ACTIONS as readonly string[]).includes(action)) throw notFound("Action");
    return entryAction(ctx, entryId, action as EntryAction, await body(req, entryActionInput));
  },
);
