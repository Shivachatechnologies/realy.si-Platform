import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Empty, Facts, guard } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { getPlatformInvoice } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** One mirrored invoice: amounts (subtotal, discounts, tax where Stripe reported it), payments, refunds, events. */
export default async function InvoiceDetailPage({ params }: PageProps<"/[locale]/invoices/[invoiceId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { invoiceId } = await params;
  const res = await guard(getPlatformInvoice(viewer.ctx, invoiceId), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { invoice: i, payments, refunds, organization, subscription, events } = res.value;
  const m = (v: bigint) => formatMoney({ amountMinor: v, currency: i.currency }, locale);
  const base = `/${locale}`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: i.number ?? i.stripeInvoiceId }]} />
      <AdminHeader
        icon={<FileText />}
        eyebrow={<Link href={`${base}/invoices`} className="hover:underline">{t("admin.invoices.title")}</Link>}
        title={i.number ?? i.stripeInvoiceId}
        description={`${m(i.totalMinor)} · ${t(`admin.invoices.status.${i.status}`)}`}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge domain="invoice" value={i.status}>{t(`admin.invoices.status.${i.status}`)}</StatusBadge>
            {!i.livemode ? <Badge tone="warning">{t("admin.invoices.common.test")}</Badge> : null}
            <span className="font-mono">{i.stripeInvoiceId}</span>
            <CopyButton value={i.stripeInvoiceId} label={t("admin.invoices.stripeId")} />
          </span>
        }
        actions={
          i.hostedUrl ? (
            <a href={i.hostedUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {t("admin.invoices.hosted")} <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.invoices.amounts")} />
          <Facts
            rows={[
              [t("admin.invoices.subtotal"), m(i.subtotalMinor)],
              [t("admin.invoices.discount"), i.discountMinor ? `−${m(i.discountMinor)}` : "—"],
              [t("admin.invoices.tax"), i.taxKnown ? m(i.taxMinor) : t("admin.invoices.taxUnknown")],
              [t("admin.invoices.total"), m(i.totalMinor)],
              [t("admin.invoices.paid"), m(i.amountPaidMinor)],
              [t("admin.invoices.remaining"), m(i.amountRemainingMinor)],
              [t("admin.invoices.attempts"), String(i.attemptCount)],
              [t("admin.invoices.common.currency"), i.currency],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.invoices.metadata")} />
          <Facts
            rows={[
              [t("admin.invoices.common.organization"), organization ? <Link href={`${base}/organizations/${organization.id}`} className="hover:underline">{organization.name}</Link> : t("admin.invoices.common.unmatched")],
              [t("admin.invoices.subscription"), subscription ? <Link href={`${base}/subscriptions/${subscription.id}`} className="hover:underline">{`${subscription.plan.name} · ${subscription.status}`}</Link> : (i.stripeSubscriptionId ?? "—")],
              [t("admin.invoices.reason"), i.billingReason ?? "—"],
              [t("admin.invoices.period"), i.periodStart && i.periodEnd ? <><Timestamp value={i.periodStart} mode="absolute" /> – <Timestamp value={i.periodEnd} mode="absolute" /></> : "—"],
              [t("admin.invoices.common.created"), <Timestamp key="c" value={i.createdAt} />],
              [t("admin.invoices.due"), <Timestamp key="d" value={i.dueAt} />],
              [t("admin.invoices.paidAt"), <Timestamp key="p" value={i.paidAt} />],
              [t("admin.invoices.common.lastSynced"), <Timestamp key="s" value={i.syncedAt} />],
            ]}
          />
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.payments.title")} description={t("admin.invoices.paymentsHint")} />
        {payments.length === 0 ? (
          <Empty>{t("admin.invoices.noPayments")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.payments.charge")}</Th>
                <Th>{t("admin.invoices.common.status")}</Th>
                <Th>{t("admin.invoices.common.amount")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`${base}/payments/${p.id}`} className="font-mono text-xs hover:underline">
                      {p.stripeChargeId ?? p.stripePaymentIntentId}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge domain="payment" value={p.status}>{t(`admin.payments.status.${p.status}`)}</StatusBadge>
                  </Td>
                  <Td className="tabular text-xs">{formatMoney({ amountMinor: p.amountMinor, currency: p.currency }, locale)}</Td>
                  <Td className="text-xs"><Timestamp value={p.createdAt} mode="absolute" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {refunds.length ? (
          <CardBody>
            <p className="text-xs text-muted-foreground">{t("admin.invoices.refundsLinked", { count: refunds.length })}</p>
          </CardBody>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("admin.invoices.events")} description={t("admin.invoices.eventsHint")} />
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
  );
}
