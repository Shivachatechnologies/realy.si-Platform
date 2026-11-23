import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, AuditTimeline, Empty, Facts, SectionLink, guard } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SubscriptionAdminActions } from "@/components/admin/billing/actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { canPlatform } from "@/server/modules/admin/access";
import { getSubscriptionDetail, liveStripeSubscription } from "@/server/modules/admin/billing";
import { PLAN_KEYS } from "@/server/modules/entitlements/catalog";
import { requireViewer } from "@/server/session";

/** One subscription: overview, items and price versions, invoices and payments, Stripe live state, actions, audit, events. */
export default async function SubscriptionDetailPage({ params }: PageProps<"/[locale]/subscriptions/[subscriptionId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { subscriptionId } = await params;
  const res = await guard(getSubscriptionDetail(viewer.ctx, subscriptionId), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { subscription: s, monthlyMinor, invoices, payments, audit, events, history, ledger } = res.value;
  const [live, canManage, plans] = await Promise.all([
    liveStripeSubscription(viewer.ctx, s.stripeSubscriptionId),
    canPlatform(viewer.ctx, "platform.subscriptions.manage"),
    db().plan.findMany({ where: { status: "ACTIVE" }, orderBy: { sortOrder: "asc" }, select: { key: true } }),
  ]);
  const base = `/${locale}`;
  const tz = viewer.user.timezone;
  const m = (v: bigint, c = s.currency) => formatMoney({ amountMinor: v, currency: c }, locale);
  const pause = live.state === "ok" ? live.pauseCollection : null;
  const planKeys = plans.length ? plans.map((p) => p.key) : [...PLAN_KEYS];
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: s.organization.name }]} />
      <AdminHeader
        icon={<ReceiptText />}
        eyebrow={<Link href={`${base}/subscriptions`} className="hover:underline">{t("admin.nav.subscriptions")}</Link>}
        title={`${s.organization.name} · ${s.plan.name}`}
        description={`${m(monthlyMinor)} ${t("admin.subscriptions.detail.perMonth")} · ${t(`admin.subscriptions.interval.${s.interval}`)} · ${s.billingCountryCode}`}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge domain="subscription" value={s.status}>{t(`admin.subscriptions.status.${s.status}`)}</StatusBadge>
            {s.cancelAtPeriodEnd ? <Badge tone="warning">{t("admin.subscriptions.cancelsAtEnd")}</Badge> : null}
            {pause ? <Badge tone="warning">{t("admin.subscriptions.detail.collectionPaused", { behavior: pause })}</Badge> : null}
            {s.stripeSubscriptionId ? (
              <>
                <span className="font-mono">{s.stripeSubscriptionId}</span>
                <CopyButton value={s.stripeSubscriptionId} label={t("admin.subscriptions.detail.stripeId")} />
              </>
            ) : null}
          </span>
        }
      />
      {live.state === "unavailable" ? <Notice tone="warning">{t("admin.subscriptions.detail.liveUnavailable", { error: live.error })}</Notice> : null}
      {live.state === "not_configured" ? <Notice tone="info">{t("admin.invoices.common.notConfigured")}</Notice> : null}
      {s.status === "PAST_DUE" || s.status === "UNPAID" ? (
        <Notice tone="danger" title={t("admin.subscriptions.detail.pastDue")} action={<SectionLink href={`${base}/payments?org=${s.organizationId}&status=failed`}>{t("admin.subscriptions.detail.investigate")}</SectionLink>}>
          {t("admin.subscriptions.detail.pastDueHint", { date: s.lastPaymentFailedAt ? formatDateTime(s.lastPaymentFailedAt, locale, tz) : "—" })}
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.subscriptions.detail.overview")} />
          <Facts
            rows={[
              [t("admin.invoices.common.organization"), <Link key="o" href={`${base}/organizations/${s.organization.id}`} className="hover:underline">{s.organization.name}</Link>],
              [t("admin.subscriptions.plan"), `${s.plan.name} (${s.plan.key})`],
              [t("admin.subscriptions.detail.period"), s.currentPeriodStart && s.currentPeriodEnd ? `${formatDateTime(s.currentPeriodStart, locale, tz)} – ${formatDateTime(s.currentPeriodEnd, locale, tz)}` : "—"],
              [t("admin.subscriptions.detail.trialEnds"), <Timestamp key="t" value={s.trialEndsAt} />],
              [t("admin.subscriptions.detail.canceledAt"), <Timestamp key="c" value={s.canceledAt} />],
              [t("admin.subscriptions.detail.lastPaid"), <Timestamp key="p" value={s.lastPaymentSucceededAt} />],
              [t("admin.subscriptions.detail.lastFailed"), <Timestamp key="f" value={s.lastPaymentFailedAt} />],
              [t("admin.invoices.common.created"), <Timestamp key="cr" value={s.createdAt} />],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.subscriptions.detail.actions")} description={canManage ? undefined : t("admin.subscriptions.detail.actionsForbidden")} />
          <CardBody>
            {canManage ? (
              <SubscriptionAdminActions
                subscriptionId={s.id}
                status={s.status}
                cancelAtPeriodEnd={s.cancelAtPeriodEnd}
                pauseCollection={pause}
                trialEndsAt={s.trialEndsAt?.toISOString() ?? null}
                planKeys={planKeys}
                orgSlug={s.organization.slug}
                stripe={!!s.stripeSubscriptionId}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("errors.forbidden")}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <SectionLink href={`${base}/credits?org=${s.organizationId}`}>{t("admin.subscriptions.detail.credits")}</SectionLink>
              <SectionLink href={`${base}/plans/organizations/${s.organizationId}`}>{t("admin.subscriptions.detail.entitlements")}</SectionLink>
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.subscriptions.detail.items")} description={t("admin.subscriptions.detail.itemsHint")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.subscriptions.detail.market")}</Th>
              <Th>{t("admin.subscriptions.detail.version")}</Th>
              <Th>{t("admin.invoices.common.amount")}</Th>
              <Th>{t("admin.subscriptions.detail.quantity")}</Th>
              <Th>{t("admin.subscriptions.detail.since")}</Th>
            </Tr>
          </THead>
          <TBody>
            {s.items.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono text-xs">{i.priceVersion.price.marketType}:{i.priceVersion.price.marketCode} · {i.priceVersion.price.interval}</Td>
                <Td className="text-xs">v{i.priceVersion.version} · {formatDateTime(i.priceVersion.effectiveFrom, locale, tz)}</Td>
                <Td className="tabular text-xs">{m(i.unitAmountMinor, i.currency)}</Td>
                <Td className="tabular text-xs">{i.quantity}</Td>
                <Td className="text-xs"><Timestamp value={i.createdAt} mode="absolute" /></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title={t("admin.invoices.title")} actions={<SectionLink href={`${base}/invoices?org=${s.organizationId}`}>{t("admin.subscriptions.detail.allInvoices")}</SectionLink>} />
        {invoices.length === 0 ? (
          <Empty>{t("admin.subscriptions.detail.noInvoices")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.invoices.number")}</Th>
                <Th>{t("admin.invoices.common.status")}</Th>
                <Th>{t("admin.invoices.total")}</Th>
                <Th>{t("admin.subscriptions.detail.payments")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {invoices.map((i) => (
                <Tr key={i.id}>
                  <Td><Link href={`${base}/invoices/${i.id}`} className="hover:underline">{i.number ?? i.stripeInvoiceId}</Link></Td>
                  <Td><StatusBadge domain="invoice" value={i.status}>{t(`admin.invoices.status.${i.status}`)}</StatusBadge></Td>
                  <Td className="tabular text-xs">{m(i.totalMinor, i.currency)}</Td>
                  <Td className="text-xs">{payments.filter((p) => p.stripeInvoiceId === i.stripeInvoiceId).map((p) => t(`admin.payments.status.${p.status}`)).join(", ") || "—"}</Td>
                  <Td className="text-xs"><Timestamp value={i.createdAt} mode="absolute" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.invoices.common.audit")} description={t("admin.subscriptions.detail.auditHint")} />
          {audit.length === 0 ? (
            <Empty>{t("admin.invoices.common.noAudit")}</Empty>
          ) : (
            <AuditTimeline
              items={audit.map((a) => ({
                id: a.id,
                who: a.actorName ?? (a.actorType === "SYSTEM" ? "Stripe" : (a.actorId ?? "—")),
                action: a.action,
                security: a.category === "SECURITY",
                reason: a.reason,
                iso: a.createdAt.toISOString(),
                exact: formatDateTime(a.createdAt, locale, tz),
                relative: formatRelativeTime(a.createdAt, locale),
              }))}
            />
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.invoices.events")} description={t("admin.subscriptions.detail.eventsHint")} />
          {events.length === 0 ? (
            <Empty>{t("admin.invoices.noEvents")}</Empty>
          ) : (
            <ul className="grid divide-y text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span className="font-mono text-xs">{e.type}</span>
                  <Badge tone={e.outcome === "applied" ? "success" : e.outcome === "ignored" ? "neutral" : "warning"}>{e.outcome}</Badge>
                  <Timestamp value={e.processedAt} mode="relative" className="text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.subscriptions.detail.history")} />
          {history.length === 0 ? (
            <Empty>{t("admin.subscriptions.detail.noHistory")}</Empty>
          ) : (
            <ul className="grid divide-y text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <Link href={`${base}/subscriptions/${h.id}`} className="hover:underline">{h.plan.name}</Link>
                  <StatusBadge domain="subscription" value={h.status}>{t(`admin.subscriptions.status.${h.status}`)}</StatusBadge>
                  <Timestamp value={h.createdAt} mode="absolute" className="text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.credits.title")} actions={<SectionLink href={`${base}/credits?org=${s.organizationId}`}>{t("admin.credits.open")}</SectionLink>} />
          {ledger.length === 0 ? (
            <Empty>{t("admin.credits.empty")}</Empty>
          ) : (
            <ul className="grid divide-y text-sm">
              {ledger.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <StatusBadge domain="creditLedger" value={l.kind}>{t(`admin.credits.kinds.${l.kind}`)}</StatusBadge>
                  <span className="font-mono text-xs">{l.meter}</span>
                  <span className={`tabular text-xs ${l.delta < 0n ? "text-danger" : "text-success"}`}>{l.delta > 0n ? "+" : ""}{l.delta.toString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
