import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteNote } from "@/server/modules/admin/people";

export const DELETE = route<{ noteId: string }>({ auth: "required", name: "DELETE /admin/notes/:id", rateLimits: LIMITS.admin }, async ({ ctx }, { noteId }) => deleteNote(ctx, noteId));
