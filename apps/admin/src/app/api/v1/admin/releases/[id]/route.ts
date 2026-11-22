import { notFound } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { getRelease } from "@/server/modules/admin/releases";

export const GET = route<{ id: string }>({ auth: "required", name: "GET /admin/releases/:id" }, async ({ ctx }, { id }) => {
  const r = await getRelease(ctx, id);
  if (!r) throw notFound("Release");
  return r;
});
