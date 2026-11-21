import { route } from "@/server/core/http";
import { searchMemory } from "@/server/modules/brain/context";
import { MEMORY_LAYERS, MEMORY_SCOPES, type MemoryLayerKey, type MemoryScopeKey } from "@/server/modules/brain/memory-policy";

type P = { orgId: string; companyId: string };

/** Hybrid memory search (full-text, plus semantic when configured) with citations. ?q=&layer=&scope= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = req.nextUrl.searchParams;
  const layer = sp.get("layer");
  const scope = sp.get("scope");
  return searchMemory(ctx, orgId, companyId, (sp.get("q") ?? "").slice(0, 300), {
    layers: layer && (MEMORY_LAYERS as readonly string[]).includes(layer) ? [layer as MemoryLayerKey] : undefined,
    scopes: scope && (MEMORY_SCOPES as readonly string[]).includes(scope) ? [scope as MemoryScopeKey] : undefined,
  });
});
