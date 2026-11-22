import { db } from "@/server/core/db";
import { CONTROL_KEYS } from "@/server/core/platform-controls";
import { capabilitiesFor } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stream F: platform switches/settings (by key; the palette also matches translated labels), integration providers,
 * API keys (name or prefix, never secrets), webhook endpoints, feature flags, CMS entries, platform support tickets
 * (#number, subject, requester) and audit records by request id. Each group runs only for admins who may see it.
 */
export const platformSearch = defineSearchProvider({
  group: "platform",
  perms: ["platform.audit.read", "platform.organizations.read", "platform.security.read", "platform.support.read", "flags.read", "platform.content.manage"],
  empty: {
    controls: [] as string[],
    integrations: [] as { provider: string; connections: number }[],
    apiKeys: [] as { id: string; name: string; prefix: string }[],
    webhooks: [] as { id: string; name: string; url: string }[],
    flags: [] as { id: string; key: string }[],
    cmsEntries: [] as { id: string; slug: string; kind: string }[],
    tickets: [] as { id: string; number: number; subject: string; status: string }[],
    auditRequests: [] as { id: string; action: string; requestId: string }[],
  },
  async search(ctx, q) {
    const caps = await capabilitiesFor(ctx, ["platform.audit.read", "platform.organizations.read", "platform.security.read", "platform.support.read", "flags.read", "platform.content.manage"]);
    const needle = q.toLowerCase();
    const num = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
    const security = caps["platform.security.read"];
    const [providerRows, apiKeys, webhooks, flags, cmsEntries, tickets, auditRequests] = await Promise.all([
      caps["platform.organizations.read"] ? db().integrationConnection.groupBy({ by: ["provider"], where: { provider: ciContains(q) }, _count: { _all: true } }) : [],
      security ? db().apiKey.findMany({ where: { OR: [{ name: ciContains(q) }, { prefix: { startsWith: q.replace(/^rly_/, "") } }] }, select: { id: true, name: true, prefix: true }, take: 5 }) : [],
      security ? db().integrationWebhookSubscription.findMany({ where: { OR: [{ name: ciContains(q) }, { url: ciContains(q) }] }, select: { id: true, name: true, url: true }, take: 5 }) : [],
      caps["flags.read"] ? db().featureFlag.findMany({ where: { key: ciContains(q) }, select: { id: true, key: true }, take: 5 }) : [],
      caps["platform.content.manage"] ? db().cmsEntry.findMany({ where: { slug: ciContains(q) }, select: { id: true, slug: true, kind: true }, take: 5 }) : [],
      caps["platform.support.read"]
        ? db().platformSupportTicket.findMany({ where: { OR: [...(num ? [{ number: num }] : []), { subject: ciContains(q) }, { requesterEmail: ciContains(q) }] }, select: { id: true, number: true, subject: true, status: true }, orderBy: { id: "desc" }, take: 5 })
        : [],
      caps["platform.audit.read"] && (UUID.test(q) || /^req_[A-Za-z0-9_-]{6,}$/.test(q))
        ? db().auditLog.findMany({ where: { OR: [{ requestId: q }, ...(UUID.test(q) ? [{ id: q }] : [])] }, select: { id: true, action: true, requestId: true }, orderBy: { id: "desc" }, take: 5 })
        : [],
    ]);
    return {
      controls: caps["platform.audit.read"] ? CONTROL_KEYS.filter((k) => k.toLowerCase().includes(needle)) : [],
      integrations: providerRows.slice(0, 8).map((p) => ({ provider: p.provider, connections: p._count._all })),
      apiKeys,
      webhooks,
      flags,
      cmsEntries: cmsEntries.map((e) => ({ ...e, kind: String(e.kind) })),
      tickets: tickets.map((t) => ({ ...t, status: String(t.status) })),
      auditRequests: auditRequests.map((a) => ({ id: a.id, action: a.action, requestId: a.requestId ?? "" })),
    };
  },
});
