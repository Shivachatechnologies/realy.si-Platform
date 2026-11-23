import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Empty, Facts, guard } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { RefundButton } from "@/components/admin/billing/actions";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { getPlatformPayment } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** One mirrored payment: amounts, card (brand / last 4 only), invoice, refunds (with the refund action), disputes, audit. */
export default async function PaymentDetailPage({ params }: PageProps<"/[locale]/payments/[paymentId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { paymentId } = await params;
  const res = await guard(getPlatformPayment(viewer.ctx, paymentId), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { payment: p, refunds, disputes, invoice, organization, audit, refundableMinor } = res.value;
  const canRefund = await canPlatform(viewer.ctx, "platform.billing.refund");
  const m = (v: bigint, c = p.currency) => formatMoney({ amountMinor: v, currency: c }, locale);
  const base = `/${locale}`;
  const refundable = ["succeeded", "partially_refunded"].includes(p.status) && refundableMinor > 0n && !!p.stripeChargeId;
  const label = p.stripeChargeId ?? p.stripePaymentIntentId ?? p.id;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label }]} />
      <AdminHeader
        icon={<CreditCard />}
        eyebrow={<Link href={`${base}/payments`} className="hover:underline">{t("admin.payments.title")}</Link>}
        title={m(p.amountMinor)}
        description={organization ? organization.name : t("admin.invoices.common.unmatched")}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge domain="payment" value={p.status}>{t(`admin.payments.status.${p.status}`)}</StatusBadge>
            {!p.livemode ? <Badge tone="warning">{t("admin.invoices.common.test")}</Badge> : <Badge tone="danger">{t("admin.invoices.common.live")}</Badge>}
            <span className="font-mono">{label}</span>
            <CopyButton value={label} label={t("admin.payments.charge")} />
          </span>
        }
        actions={canRefund && refundable ? <RefundButton paymentId={p.id} chargeId={p.stripeChargeId!} currency={p.currency} refundableMinor={refundableMinor.toString()} livemode={p.livemode} /> : null}
      />
      {p.status === "disputed" ? <Notice tone="danger">{t("admin.payments.disputedNotice")}</Notice> : null}
      {!canRefund ? <Notice tone="info">{t("admin.payments.refund.forbidden")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.invoices.amounts")} />
          <Facts
            rows={[
              [t("admin.invoices.common.amount"), m(p.amountMinor)],
              [t("admin.payments.refunded"), p.refundedMinor ? m(p.refundedMinor) : "—"],
              [t("admin.payments.refundable"), m(refundableMinor)],
              [t("admin.payments.method"), p.paymentMethodBrand ? `${p.paymentMethodBrand} ···· ${p.last4 ?? ""}` : (p.paymentMethodType ?? "—")],
              [t("admin.payments.failure"), p.failureCode ? `${p.failureCode}${p.failureMessage ? ` — ${p.failureMessage}` : ""}` : "—"],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.invoices.metadata")} />
          <Facts
            rows={[
              [t("admin.invoices.common.organization"), organization ? <Link href={`${base}/organizations/${organization.id}`} className="hover:underline">{organization.name}</Link> : t("admin.invoices.common.unmatched")],
              [t("admin.invoices.title"), invoice ? <Link href={`${base}/invoices/${invoice.id}`} className="hover:underline">{invoice.number ?? invoice.stripeInvoiceId}</Link> : (p.stripeInvoiceId ?? "—")],
              [t("admin.payments.intent"), p.stripePaymentIntentId ?? "—"],
              [t("admin.invoices.common.created"), <Timestamp key="c" value={p.createdAt} />],
              [t("admin.invoices.common.lastSynced"), <Timestamp key="s" value={p.syncedAt} />],
            ]}
          />
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.payments.refunds.title")} />
        {refunds.length === 0 ? (
          <Empty>{t("admin.payments.refunds.none")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.payments.refunds.id")}</Th>
                <Th>{t("admin.invoices.common.status")}</Th>
                <Th>{t("admin.invoices.common.amount")}</Th>
                <Th>{t("admin.payments.refunds.reason")}</Th>
                <Th>{t("admin.payments.refunds.source")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {refunds.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">{r.stripeRefundId}</Td>
                  <Td><StatusBadge domain="refund" value={r.status}>{t(`admin.payments.refunds.status.${r.status}`)}</StatusBadge></Td>
                  <Td className="tabular text-xs">{m(r.amountMinor, r.currency)}</Td>
                  <Td className="text-xs">{r.reason ?? "—"}</Td>
                  <Td className="text-xs">{r.createdById ? t("admin.payments.refunds.console") : t("admin.payments.refunds.external")}</Td>
                  <Td className="text-xs"><Timestamp value={r.createdAt} mode="absolute" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.payments.disputes.title")} />
        {disputes.length === 0 ? (
          <Empty>{t("admin.payments.disputes.none")}</Empty>
        ) : (
          <ul className="grid divide-y text-sm">
            {disputes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <Link href={`${base}/payments/disputes/${d.id}`} className="font-mono text-xs hover:underline">{d.stripeDisputeId}</Link>
                <StatusBadge domain="dispute" value={d.status}>{t(`admin.payments.disputes.status.${d.status}`)}</StatusBadge>
                <span className="tabular text-xs">{m(d.amountMinor, d.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.invoices.common.audit")} />
        {audit.length === 0 ? (
          <Empty>{t("admin.invoices.common.noAudit")}</Empty>
        ) : (
          <CardBody>
            <ul className="grid gap-2 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent" className="font-mono">{a.action}</Badge>
                  {a.reason ? <span className="text-xs text-muted-foreground">“{a.reason}”</span> : null}
                  <Timestamp value={a.createdAt} mode="relative" className="ms-auto text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
