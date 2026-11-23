import Link from "next/link";
import { KeyRound, Webhook, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, FilterBar, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { WebhookToggle } from "@/components/admin/platform-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { developersOverview } from "@/server/modules/admin/developers";
import { rateLimitSummary } from "@/server/modules/admin/api-logs";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { requireViewer } from "@/server/session";

/** API & webhooks across tenants: API keys (revoke), webhook subscriptions (disable / enable) and delivery failures. */
export default async function AdminDevelopersPage({ searchParams }: PageProps<"/[locale]/developers">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), keys: sp(q.keys), org: sp(q.org) };
  const r = await guard(Promise.all([developersOverview(viewer.ctx, params), canPlatform(viewer.ctx, "platform.security.manage"), rateLimitSummary(viewer.ctx, 7)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canManage, limited] = r.value;
  const base = `/${locale}/developers`;
  const orgLink = (id: string, name: string) => (
    <Link href={`/${locale}/organizations/${id}`} className="hover:underline">
      {name}
    </Link>
  );
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<KeyRound />}
        title={t("admin.nav.developers")}
        description={t("admin.developers.subtitle")}
        why={t("admin.developers.why")}
        actions={
          <>
            <Link href={`/${locale}/api-logs`} className="text-xs text-primary hover:underline">{t("admin.developers.openApiLogs")}</Link>
            <Link href={`/${locale}/webhooks`} className="text-xs text-primary hover:underline">{t("admin.developers.openWebhooks")}</Link>
          </>
        }
      />
      <StatGrid>
        <StatTile icon={<KeyRound />} label={t("admin.developers.activeKeys")} value={o.keyCounts.active} hint={t("admin.developers.used7d", { count: o.keyCounts.used7d })} href={`${base}?keys=active`} />
        <StatTile icon={<Webhook />} label={t("admin.developers.webhooks")} value={o.webhooks.filter((w) => w.active).length} hint={t("admin.developers.disabledCount", { count: o.webhooks.filter((w) => !w.active).length })} />
        <StatTile icon={<AlertTriangle />} label={t("admin.developers.failures")} value={o.failures.length} tone={o.failures.length ? "warning" : undefined} />
        <StatTile label={t("admin.developers.failing7d")} value={o.webhooks.filter((w) => w.failed7d > 0).length} tone={o.webhooks.some((w) => w.failed7d > 0) ? "danger" : undefined} />
      </StatGrid>
      <Card>
        <CardHeader icon={<KeyRound />} title={t("admin.developers.apiKeys")} description={t("admin.developers.apiKeysHint")} />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.developers.searchKeys")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[{ name: "keys", label: t("admin.users.filters.status"), options: (["active", "revoked", "expired"] as const).map((s) => ({ value: s, label: t(`admin.developers.keyState.${s}`) })) }]}
        />
        {o.keys.length === 0 ? (
          <Empty>{t("admin.developers.noKeys")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.developers.key")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.developers.lastUsed")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.keys.map((k) => (
                <Tr key={k.id}>
                  <Td>
                    <Link href={`${base}/keys/${k.id}`} className="font-medium text-primary hover:underline">{k.name}</Link>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {k.prefix}… · {k.serviceAccount.name}
                    </div>
                  </Td>
                  <Td className="text-xs">{orgLink(k.organizationId, k.organizationName)}</Td>
                  <Td className="text-xs text-muted-foreground">{k.lastUsedAt ? formatRelativeTime(k.lastUsedAt, locale) : t("admin.developers.never")}</Td>
                  <Td>
                    <StatusBadge domain="apiKey" value={k.state}>{t(`admin.developers.keyState.${k.state}`)}</StatusBadge>
                  </Td>
                  <Td className="text-end">
                    {canManage && k.state === "active" ? <ActionButton label={t("admin.developers.revoke")} title={t("admin.developers.revokeTitle", { name: k.name })} description={t("admin.developers.revokeHint")} path={`/api/v1/admin/api-keys/${k.id}`} method="DELETE" danger variant="ghost" /> : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<AlertTriangle />} title={t("admin.developers.rateLimited")} description={t("admin.developers.rateLimitedHint", { count: limited.total })} actions={<Link href={`/${locale}/api-logs?view=limits`} className="text-xs text-primary hover:underline">{t("admin.developers.allEvents")}</Link>} />
        {limited.byRule.length === 0 ? (
          <Empty>{t("admin.developers.noRateLimited")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.developers.rule")}</Th>
                <Th>{t("admin.developers.events429")}</Th>
              </Tr>
            </THead>
            <TBody>
              {limited.byRule.map((b) => (
                <Tr key={b.rule}>
                  <Td className="font-mono text-xs">{b.rule}</Td>
                  <Td className="text-xs tabular-nums">{b.count}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Webhook />} title={t("admin.developers.webhooks")} description={t("admin.developers.webhooksHint")} actions={<Link href={`/${locale}/webhooks`} className="text-xs text-primary hover:underline">{t("admin.developers.openWebhooks")}</Link>} />
        {o.webhooks.length === 0 ? (
          <Empty>{t("admin.developers.noWebhooks")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.developers.endpoint")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.developers.events")}</Th>
                <Th>{t("admin.developers.deliveries7d")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.webhooks.map((w) => (
                <Tr key={w.id}>
                  <Td>
                    <div className="font-medium">
                      <Link href={`/${locale}/webhooks/${w.id}`} className="text-primary hover:underline">{w.name}</Link> {!w.active ? <Badge tone="neutral">{t("admin.developers.disabled")}</Badge> : null}
                    </div>
                    <div className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">{w.url}</div>
                  </Td>
                  <Td className="text-xs">
                    {orgLink(w.organizationId, w.organizationName)}
                    <div className="text-[11px] text-muted-foreground">{w.company.name}</div>
                  </Td>
                  <Td className="max-w-40 truncate font-mono text-[11px]">{w.eventTypes.join(", ")}</Td>
                  <Td className="text-xs tabular-nums">
                    <span className="text-success">{w.delivered7d}</span> / <span className={w.failed7d ? "text-danger" : ""}>{w.failed7d}</span> / <span className="text-muted-foreground">{w.pending}</span>
                  </Td>
                  <Td className="text-end">{canManage ? <WebhookToggle id={w.id} name={w.name} active={w.active} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<AlertTriangle />} title={t("admin.developers.failures")} description={t("admin.developers.failuresHint")} />
        {o.failures.length === 0 ? (
          <Empty>{t("admin.developers.noFailures")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.developers.event")}</Th>
                <Th>{t("admin.developers.endpoint")}</Th>
                <Th>{t("admin.developers.error")}</Th>
                <Th>{t("admin.developers.when")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.failures.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-mono text-[11px]">{d.eventType}</Td>
                  <Td className="text-xs">
                    {d.subscription.name} · {orgLink(d.organizationId, d.organizationName)}
                  </Td>
                  <Td className="max-w-xs text-xs">
                    <span className="font-mono">{d.lastStatusCode ?? "—"}</span> <span className="text-muted-foreground">{d.lastError?.slice(0, 120)}</span>
                    <div className="text-[11px] text-muted-foreground">{t("admin.developers.attempts", { count: d.attempts })}</div>
                  </Td>
                  <Td className="text-xs text-muted-foreground">{formatRelativeTime(d.updatedAt, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
