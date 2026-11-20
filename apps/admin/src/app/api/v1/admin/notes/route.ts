import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addNote, listNotes, noteInput } from "@/server/modules/admin/people";

const target = z.enum(["user", "organization"]);
const createInput = noteInput.extend({ target, targetId: z.string().uuid() });

/** Internal admin notes about a user or organization: GET ?target=&targetId=, POST { target, targetId, body, pinned }. */
export const GET = route({ auth: "required", name: "GET /admin/notes" }, async ({ req, ctx }) => {
  const p = req.nextUrl.searchParams;
  return { data: await listNotes(ctx, target.parse(p.get("target")), p.get("targetId") ?? "") };
});

export const POST = route({ auth: "required", name: "POST /admin/notes", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => {
  const { target: tt, targetId, ...rest } = createInput.parse(await body(req, createInput));
  return addNote(ctx, tt, targetId, rest);
});
