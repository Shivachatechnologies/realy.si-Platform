import Link from "next/link";
import { ExternalLink, Gavel } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Facts, guard } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { OPEN_DISPUTE_STATUSES, getPlatformDispute } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** One dispute. Evidence is submitted in the Stripe dashboard (the link opens it); the console only mirrors status. */
export default async function DisputeDetailPage({ params }: PageProps<"/[locale]/payments/disputes/[disputeId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { disputeId } = await params;
  const res = await guard(getPlatformDispute(viewer.ctx, disputeId), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { dispute: d, payment, organization } = res.value;
  const base = `/${locale}`;
  const open = OPEN_DISPUTE_STATUSES.includes(d.status);
  const dashboard = `https://dashboard.stripe.com/${d.livemode ? "" : "test/"}disputes/${encodeURIComponent(d.stripeDisputeId)}`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.payments.disputes.title"), href: `${base}/payments/disputes` }, { label: d.stripeDisputeId }]} />
      <AdminHeader
        icon={<Gavel />}
        title={formatMoney({ amountMinor: d.amountMinor, currency: d.currency }, locale)}
        description={`${d.reason} · ${organization?.name ?? t("admin.invoices.common.unmatched")}`}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge domain="dispute" value={d.status}>{t(`admin.payments.disputes.status.${d.status}`)}</StatusBadge>
            {!d.livemode ? <Badge tone="warning">{t("admin.invoices.common.test")}</Badge> : null}
            <span className="font-mono">{d.stripeDisputeId}</span>
            <CopyButton value={d.stripeDisputeId} label={t("admin.payments.disputes.id")} />
          </span>
        }
        actions={
          <a href={dashboard} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {t("admin.payments.disputes.respond")} <ExternalLink className="size-3" aria-hidden />
          </a>
        }
      />
      {open ? <Notice tone="danger" title={t("admin.payments.disputes.nextStep")}>{t("admin.payments.disputes.nextStepBody")}</Notice> : null}
      <Card>
        <CardHeader title={t("admin.invoices.metadata")} />
        <Facts
          rows={[
            [t("admin.payments.disputes.due"), <Timestamp key="d" value={d.evidenceDueBy} />],
            [t("admin.payments.disputes.reason"), d.reason],
            [t("admin.payments.disputes.refundable"), d.isChargeRefundable ? t("admin.invoices.common.yes") : t("admin.invoices.common.no")],
            [t("admin.payments.charge"), payment ? <Link href={`${base}/payments/${payment.id}`} className="font-mono hover:underline">{payment.stripeChargeId}</Link> : (d.stripeChargeId ?? "—")],
            [t("admin.invoices.common.organization"), organization ? <Link href={`${base}/organizations/${organization.id}`} className="hover:underline">{organization.name}</Link> : t("admin.invoices.common.unmatched")],
            [t("admin.invoices.common.created"), <Timestamp key="c" value={d.createdAt} />],
            [t("admin.invoices.common.lastSynced"), <Timestamp key="u" value={d.updatedAt} />],
          ]}
        />
      </Card>
    </div>
  );
}
