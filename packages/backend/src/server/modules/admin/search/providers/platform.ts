import { db } from "@/server/core/db";
import { CONTROL_KEYS } from "@/server/core/platform-controls";
import { canPlatform } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

/** Stream F: platform switches/settings (by key; the palette also matches translated labels) and integration providers. */
export const platformSearch = defineSearchProvider({
  group: "platform",
  perms: ["platform.audit.read", "platform.organizations.read"],
  empty: { controls: [] as string[], integrations: [] as { provider: string; connections: number }[] },
  async search(ctx, q) {
    const [controls, orgs] = await Promise.all([canPlatform(ctx, "platform.audit.read"), canPlatform(ctx, "platform.organizations.read")]);
    const providerRows = orgs ? await db().integrationConnection.groupBy({ by: ["provider"], where: { provider: ciContains(q) }, _count: { _all: true } }) : [];
    const needle = q.toLowerCase();
    return {
      controls: controls ? CONTROL_KEYS.filter((k) => k.toLowerCase().includes(needle)) : [],
      integrations: providerRows.map((p) => ({ provider: p.provider, connections: p._count._all })),
    };
  },
});
