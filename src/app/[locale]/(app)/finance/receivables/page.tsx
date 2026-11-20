import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { Empty, INVOICE_TONE, Kpi, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AGING_BUCKETS, receivablesAging } from "@/server/modules/finance/billing";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.receivables") };
}

export default async function ReceivablesPage() {
  const p = await financePage("receivables");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const aging = await receivablesAging(viewer.ctx, org.id, company.id);
  const overdue = aging.invoices.filter((i) => i.bucket !== "current");
  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("finance.receivables.total")} value={money(aging.total)} />
        {AGING_BUCKETS.map((b) => (
          <Kpi key={b} label={t(`finance.receivables.buckets.${b}`)} value={money(aging.totals[b])} tone={b === "d90_plus" && aging.totals[b] > 0n ? "danger" : b !== "current" && aging.totals[b] > 0n ? "warning" : undefined} />
        ))}
      </div>
      <Card>
        <CardHeader title={t("finance.receivables.byCustomer")} />
        {!aging.customers.length ? (
          <Empty>{t("finance.receivables.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.customer")}</Th>
                {AGING_BUCKETS.map((b) => (
                  <Th key={b} className="text-end">
                    {t(`finance.receivables.buckets.${b}`)}
                  </Th>
                ))}
                <Th className="text-end">{t("finance.billing.total")}</Th>
              </Tr>
            </THead>
            <TBody>
              {aging.customers.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/${locale}/finance/invoices?customer=${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  {AGING_BUCKETS.map((b) => (
                    <Td key={b} className="text-end tabular-nums">
                      {c.buckets[b] ? money(c.buckets[b]) : "—"}
                    </Td>
                  ))}
                  <Td className="text-end font-medium tabular-nums">{money(c.total)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("finance.receivables.overdueTitle")} description={t("finance.receivables.overdueHint")} />
        {!overdue.length ? (
          <Empty>{t("finance.receivables.noOverdue")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.billing.number")}</Th>
                <Th>{t("finance.fields.customer")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("finance.billing.dueDate")}</Th>
                <Th className="text-end">{t("finance.receivables.daysOverdue")}</Th>
                <Th className="text-end">{t("finance.invoices.balanceDue")}</Th>
                <Th>{t("finance.receivables.lastReminder")}</Th>
              </Tr>
            </THead>
            <TBody>
              {overdue.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <Link href={`/${locale}/finance/invoices/${i.id}`} className="font-mono font-medium hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>
                    {i.account.name}
                    {!i.account.email ? <span className="block text-xs text-warning">{t("finance.receivables.noEmail")}</span> : null}
                  </Td>
                  <Td>
                    <StatusBadge tone={INVOICE_TONE[i.status]}>{t(`finance.invoices.statuses.${i.status}`)}</StatusBadge>
                  </Td>
                  <Td className="whitespace-nowrap">{day(i.dueDate)}</Td>
                  <Td className="text-end tabular-nums">{i.daysOverdue}</Td>
                  <Td className="text-end font-medium tabular-nums">{money(i.balanceMinor, i.currency)}</Td>
                  <Td className="text-xs text-muted-foreground">{i.lastReminderAt ? formatDateTime(i.lastReminderAt, locale, p.tz) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
