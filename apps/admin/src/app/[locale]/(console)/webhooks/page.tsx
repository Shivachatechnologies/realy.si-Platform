import Link from "next/link";
import { ArrowDownToLine, CheckCircle2, Timer, Webhook, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote, pct } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { inboundWebhooks, webhookEndpoints } from "@/server/modules/admin/webhooks-admin";
import { requireViewer } from "@/server/session";

/** Webhook control center: outbound endpoints with delivery health, and the inbound webhook log. */
export default async function WebhooksPage({ searchParams }: PageProps<"/[locale]/webhooks">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const view = sp(q.view) === "inbound" ? "inbound" : "endpoints";
  const base = `/${locale}/webhooks`;
  const label = { source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") };
  const tabs = (
    <QuickFilters
      base={base}
      name="view"
      value={view === "inbound" ? "inbound" : ""}
      params={{}}
      label={t("admin.webhooks.views")}
      options={[
        { value: "", label: t("admin.webhooks.outbound") },
        { value: "inbound", label: t("admin.webhooks.inbound") },
      ]}
    />
  );
  if (view === "inbound") {
    const source = sp(q.source);
    const r = await guard(inboundWebhooks(viewer.ctx, { source, cursor: sp(q.cursor) }), t("errors.forbidden"));
    if (!r.ok) return r.node;
    const d = r.value;
    const params = { view: "inbound", source: d.source };
    return (
      <div className="grid gap-4">
        <AdminBreadcrumbs />
        <AdminHeader icon={<ArrowDownToLine />} title={t("admin.webhooks.title")} description={t("admin.webhooks.inboundSubtitle")} why={t("admin.webhooks.inboundWhy")} meta={<SourceNote source={d.source === "stripe" ? "stripe_events" : d.source === "email" ? "email_events" : "integration_provider_events"} at={new Date()} label={label} />} />
        <Card>
          {tabs}
          <QuickFilters base={base} name="source" value={d.source} params={{ view: "inbound" }} label={t("admin.webhooks.source")} options={(["provider", "stripe", "email"] as const).map((s) => ({ value: s, label: t(`admin.webhooks.sources.${s}`) }))} />
          <div className="flex flex-wrap gap-2 px-4 py-2 text-xs">
            {d.byOutcome.length ? d.byOutcome.map((b) => <Badge key={b.key}>{`${b.key}: ${b.count}`}</Badge>) : <span className="text-muted-foreground">{t("admin.settings.kit.noEvents7d")}</span>}
          </div>
          {d.rows.length === 0 ? (
            <EmptyState icon={<ArrowDownToLine />} title={t("admin.settings.kit.noEvents")} body={t("admin.webhooks.inboundEmpty")} />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.webhooks.event")}</Th>
                  <Th>{t("admin.webhooks.provider")}</Th>
                  <Th>{t("admin.webhooks.outcome")}</Th>
                  <Th>{t("admin.settings.kit.organization")}</Th>
                  <Th>{t("admin.settings.kit.when")}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.rows.map((x) => (
                  <Tr key={x.id}>
                    <Td className="font-mono text-xs">{x.type}</Td>
                    <Td className="text-xs">{x.provider}</Td>
                    <Td className="text-xs">
                      <Badge>{x.status}</Badge>
                      {x.error ? <div className="max-w-xs truncate text-[11px] text-danger">{x.error}</div> : null}
                    </Td>
                    <Td className="text-xs">{x.organizationId ? <Link href={`/${locale}/organizations/${x.organizationId}`} className="hover:underline">{x.organizationId.slice(0, 8)}</Link> : "—"}</Td>
                    <Td className="text-xs text-muted-foreground"><Timestamp value={x.at} mode="relative" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <NextPage base={base} params={params} cursor={d.nextCursor} label={t("common.next")} />
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.webhooks.notLogged")}</p>
        </Card>
      </div>
    );
  }
  const params = { state: sp(q.state), org: sp(q.org), q: sp(q.q) };
  const r = await guard(webhookEndpoints(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const d = r.value;
  const rp = d.retryPolicy;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader icon={<Webhook />} title={t("admin.webhooks.title")} description={t("admin.webhooks.subtitle")} why={t("admin.webhooks.why")} meta={<SourceNote source="integration_webhook_subscriptions · integration_webhook_deliveries" at={new Date()} label={label} />} />
      <StatGrid>
        <StatTile icon={<CheckCircle2 />} label={t("admin.webhooks.succeeded7d")} value={d.totals.succeeded} />
        <StatTile icon={<XCircle />} label={t("admin.webhooks.failed7d")} value={d.totals.failed} tone={d.totals.failed ? "danger" : undefined} href={`${base}?state=failing`} />
        <StatTile label={t("admin.webhooks.failureRate")} value={pct(d.totals.failureRate, locale) ?? t("admin.settings.kit.noData")} hint={t("admin.webhooks.pending", { count: d.totals.pending })} />
        <StatTile icon={<Timer />} label={t("admin.webhooks.latency")} value={t("admin.settings.kit.notTracked")} hint={t("admin.webhooks.latencyHint")} />
      </StatGrid>
      <Card>
        <CardHeader title={t("admin.webhooks.retryPolicy")} description={t("admin.webhooks.retryPolicyText", { attempts: rp.maxAttempts, backoff: rp.backoffMinutes.join(", "), timeout: rp.timeoutSeconds })} />
      </Card>
      <Card>
        {tabs}
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.webhooks.search")}
          values={params}
          submitLabel={t("admin.settings.kit.apply")}
          filters={[{ name: "state", label: t("admin.webhooks.state"), options: (["active", "paused", "failing"] as const).map((s) => ({ value: s, label: t(`admin.webhooks.states.${s}`) })) }]}
          extra={params.org ? <input type="hidden" name="org" value={params.org} /> : undefined}
        />
        {d.data.length === 0 ? (
          <EmptyState icon={<Webhook />} title={t("admin.webhooks.empty")} body={t("admin.common.tryOtherFilters")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.webhooks.endpoint")}</Th>
                <Th>{t("admin.settings.kit.organization")}</Th>
                <Th>{t("admin.webhooks.deliveries7d")}</Th>
                <Th>{t("admin.webhooks.failureRate")}</Th>
                <Th>{t("admin.webhooks.lastDelivery")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.data.map((w) => (
                <Tr key={w.id}>
                  <Td>
                    <Link href={`${base}/${w.id}`} className="font-medium text-primary hover:underline">
                      {w.name}
                    </Link>{" "}
                    {!w.active ? <Badge tone="neutral">{t("admin.webhooks.states.paused")}</Badge> : null}
                    <div className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">{w.url}</div>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/organizations/${w.organizationId}`} className="hover:underline">{w.organizationName}</Link>
                    <div className="text-[11px] text-muted-foreground">{w.company.name}</div>
                  </Td>
                  <Td className="text-xs tabular-nums">
                    <span className="text-success">{w.succeeded7d}</span> / <span className={w.failed7d ? "text-danger" : ""}>{w.failed7d}</span> / <span className="text-muted-foreground">{w.pending}</span>
                  </Td>
                  <Td className="text-xs">{pct(w.failureRate, locale) ?? "—"}</Td>
                  <Td className="text-xs text-muted-foreground">{w.lastDeliveryAt ? <Timestamp value={w.lastDeliveryAt} mode="relative" /> : t("admin.settings.kit.never")}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={d.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
