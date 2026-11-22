import Link from "next/link";
import { Gavel, SearchX } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SubNav } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { DISPUTE_STATUSES, listPlatformDisputes } from "@/server/modules/billing/explorers";
import { requireViewer } from "@/server/session";

/** Dispute explorer with the evidence-due list (respond in Stripe; nothing is submitted from here). */
export default async function DisputesPage({ searchParams }: PageProps<"/[locale]/payments/disputes">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), status: sp(q.status), org: sp(q.org), open: sp(q.open), limit: sp(q.limit) };
  const res = await guard(listPlatformDisputes(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { page, dueSoon } = res.value;
  const base = `/${locale}/payments`;
  const row = (d: (typeof page.data)[number]) => (
    <Tr key={d.id}>
      <Td>
        <Link href={`${base}/disputes/${d.id}`} className="font-mono text-xs hover:underline">{d.stripeDisputeId}</Link>
        <div className="text-[11px] text-muted-foreground">{d.reason}</div>
      </Td>
      <Td className="text-xs">{d.organization?.name ?? <span className="text-muted-foreground">{t("admin.invoices.common.unmatched")}</span>}</Td>
      <Td><StatusBadge domain="dispute" value={d.status}>{t(`admin.payments.disputes.status.${d.status}`)}</StatusBadge></Td>
      <Td className="tabular text-xs">{formatMoney({ amountMinor: d.amountMinor, currency: d.currency }, locale)}</Td>
      <Td className="text-xs whitespace-nowrap">{d.evidenceDueBy ? <Timestamp value={d.evidenceDueBy} /> : "—"}</Td>
    </Tr>
  );
  const head = (
    <THead>
      <Tr>
        <Th>{t("admin.payments.disputes.id")}</Th>
        <Th>{t("admin.invoices.common.organization")}</Th>
        <Th>{t("admin.invoices.common.status")}</Th>
        <Th>{t("admin.invoices.common.amount")}</Th>
        <Th>{t("admin.payments.disputes.due")}</Th>
      </Tr>
    </THead>
  );
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.payments.disputes.title") }]} />
      <AdminHeader icon={<Gavel />} title={t("admin.payments.disputes.title")} description={t("admin.payments.disputes.subtitle")} why={t("admin.payments.disputes.why")} />
      <SubNav
        current="disputes"
        items={[
          { key: "payments", href: base, label: t("admin.payments.title") },
          { key: "refunds", href: `${base}/refunds`, label: t("admin.payments.refunds.title") },
          { key: "disputes", href: `${base}/disputes`, label: t("admin.payments.disputes.title"), count: dueSoon.length || undefined },
        ]}
      />
      {dueSoon.length ? (
        <Card className="border-danger/40">
          <CardHeader title={t("admin.payments.disputes.dueSoon", { count: dueSoon.length })} description={t("admin.payments.disputes.dueSoonHint")} />
          <Table>
            {head}
            <TBody>{dueSoon.map(row)}</TBody>
          </Table>
        </Card>
      ) : null}
      <Card>
        <QuickFilters
          base={`${base}/disputes`}
          name="open"
          value={params.open}
          params={params}
          label={t("admin.invoices.common.status")}
          options={[
            { value: "", label: t("admin.invoices.common.all") },
            { value: "1", label: t("admin.payments.disputes.openOnly") },
          ]}
        />
        <FilterBar
          action={`${base}/disputes`}
          q={params.q}
          qLabel={t("admin.payments.disputes.search")}
          values={params}
          submitLabel={t("admin.invoices.common.apply")}
          filters={[
            { name: "status", label: t("admin.invoices.common.status"), options: DISPUTE_STATUSES.map((s) => ({ value: s, label: t(`admin.payments.disputes.status.${s}`) })) },
            { name: "limit", label: t("admin.invoices.common.pageSize"), options: ["25", "50", "100", "200"].map((n) => ({ value: n, label: n })) },
          ]}
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("admin.payments.disputes.none")} />
        ) : (
          <Table>
            {head}
            <TBody>{page.data.map(row)}</TBody>
          </Table>
        )}
        <NextPage base={`${base}/disputes`} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
