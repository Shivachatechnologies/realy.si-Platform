import Link from "next/link";
import { notFound } from "next/navigation";
import { Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, AuditTimeline, Facts, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { WebhookToggle } from "@/components/admin/platform-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { webhookEndpoint } from "@/server/modules/admin/webhooks-admin";
import { requireViewer } from "@/server/session";

/** One webhook endpoint: metadata (never the secret), 7-day stats, deliveries, actions and history. */
export default async function WebhookEndpointPage({ params, searchParams }: PageProps<"/[locale]/webhooks/[subscriptionId]">) {
  const { subscriptionId } = await params;
  const q = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const filters = { status: sp(q.status) };
  let r;
  try {
    r = await guard(Promise.all([webhookEndpoint(viewer.ctx, subscriptionId, { ...filters, cursor: sp(q.cursor) }), canPlatform(viewer.ctx, "platform.security.manage")]), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const [d, canManage] = r.value;
  const w = d.endpoint;
  const base = `/${locale}/webhooks/${w.id}`;
  const api = `/api/v1/admin/webhooks/${w.id}`;
  const done = d.stats.succeeded + d.stats.failed;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: w.name }]} />
      <AdminHeader
        icon={<Webhook />}
        title={w.name}
        eyebrow={<Badge tone={w.active ? "success" : "neutral"}>{w.active ? t("admin.webhooks.states.active") : t("admin.webhooks.states.paused")}</Badge>}
        description={w.url}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              {w.active ? <ActionButton label={t("admin.webhooks.test")} title={t("admin.webhooks.testTitle")} description={t("admin.webhooks.testHint")} path={`${api}/test`} method="POST" /> : null}
              <ActionButton label={w.active ? t("admin.webhooks.pause") : t("admin.webhooks.resume")} title={w.active ? t("admin.webhooks.pauseTitle") : t("admin.webhooks.resumeTitle")} description={w.active ? t("admin.webhooks.pauseHint") : t("admin.webhooks.resumeHint")} path={`${api}/pause`} method="PUT" body={{ paused: w.active }} />
              {w.active ? <WebhookToggle id={w.id} name={w.name} active={w.active} /> : null}
            </div>
          ) : null
        }
      />
      <StatGrid>
        <StatTile label={t("admin.webhooks.succeeded7d")} value={d.stats.succeeded} />
        <StatTile label={t("admin.webhooks.failed7d")} value={d.stats.failed} tone={d.stats.failed ? "danger" : undefined} href={`${base}?status=FAILED`} />
        <StatTile label={t("admin.webhooks.failureRate")} value={done ? `${Math.round((d.stats.failed / done) * 100)}%` : t("admin.settings.kit.noData")} />
        <StatTile label={t("admin.webhooks.pendingTitle")} value={d.stats.pending} href={`${base}?status=PENDING`} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader title={t("admin.webhooks.deliveries")} description={t("admin.webhooks.retryPolicyText", { attempts: d.retryPolicy.maxAttempts, backoff: d.retryPolicy.backoffMinutes.join(", "), timeout: d.retryPolicy.timeoutSeconds })} />
          <QuickFilters base={base} name="status" value={filters.status} params={filters} label={t("admin.webhooks.status")} options={[{ value: "", label: t("admin.common.all") }, ...(["FAILED", "PENDING", "SUCCEEDED"] as const).map((s) => ({ value: s, label: t(`admin.webhooks.deliveryStatus.${s}`) }))]} />
          {d.deliveries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.webhooks.noDeliveries")}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.webhooks.event")}</Th>
                  <Th>{t("admin.webhooks.status")}</Th>
                  <Th>{t("admin.webhooks.response")}</Th>
                  <Th>{t("admin.webhooks.attempts")}</Th>
                  <Th>{t("admin.settings.kit.when")}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.deliveries.map((x) => (
                  <Tr key={x.id}>
                    <Td>
                      <Link href={`/${locale}/webhooks/deliveries/${x.id}`} className="font-mono text-xs text-primary hover:underline">
                        {x.eventType}
                      </Link>
                    </Td>
                    <Td><StatusBadge domain="webhookDelivery" value={x.status}>{t(`admin.webhooks.deliveryStatus.${x.status}`)}</StatusBadge></Td>
                    <Td className="max-w-xs text-xs">
                      <span className="font-mono">{x.lastStatusCode ?? "—"}</span> <span className="text-muted-foreground">{x.lastError?.slice(0, 80)}</span>
                    </Td>
                    <Td className="text-xs tabular-nums">{x.attempts}</Td>
                    <Td className="text-xs text-muted-foreground"><Timestamp value={x.createdAt} mode="relative" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <NextPage base={base} params={filters} cursor={d.nextCursor} label={t("common.next")} />
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("admin.webhooks.details")} />
            <Facts
              rows={[
                [t("admin.settings.kit.organization"), <Link key="o" href={`/${locale}/organizations/${w.organizationId}`} className="text-primary hover:underline">{w.organizationName}</Link>],
                [t("admin.webhooks.company"), w.company.name],
                [t("admin.webhooks.events"), <span key="e" className="font-mono text-[11px]">{w.eventTypes.join(", ")}</span>],
                [t("admin.webhooks.secret"), t("admin.webhooks.secretHidden")],
                [t("admin.webhooks.createdBy"), w.createdBy ? `${w.createdBy.name}` : "—"],
                [t("admin.webhooks.created"), <Timestamp key="c" value={w.createdAt} />],
                [t("admin.webhooks.id"), <span key="i" className="inline-flex items-center gap-1 font-mono text-[11px]">{w.id.slice(0, 8)}<CopyButton value={w.id} /></span>],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={t("admin.webhooks.history")} />
            {d.audit.length ? (
              <AuditTimeline items={d.audit.map((a) => ({ id: a.id, who: a.actorId?.slice(0, 8) ?? "system", action: a.action, security: true, reason: a.reason, iso: a.createdAt.toISOString(), exact: formatDateTime(a.createdAt, locale, viewer.user.timezone), relative: formatRelativeTime(a.createdAt, locale) }))} />
            ) : (
              <p className="p-4 text-xs text-muted-foreground">{t("admin.settings.kit.noEvents")}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
