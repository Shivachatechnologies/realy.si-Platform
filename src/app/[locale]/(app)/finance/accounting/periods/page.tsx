import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, ResourceForm } from "@/components/finance/ui";
import { Empty, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { addDays, addMonths, dayString, monthStart, todayUtc } from "@/server/modules/finance/common";
import { listPeriods } from "@/server/modules/finance/ledger";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.periods") };
}

export default async function PeriodsPage() {
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base, day } = p;
  const periods = await listPeriods(viewer.ctx, org.id, company.id);
  const lastMonth = addMonths(monthStart(todayUtc()), -1);
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="periods" t={t} />
      {p.canManage ? (
        <Card>
          <CardHeader title={t("finance.periods.new")} description={t("finance.periods.hint")} />
          <div className="p-4">
            <ResourceForm
              endpoint={`${base}/periods`}
              submitLabel={t("finance.periods.new")}
              initial={{ name: dayString(lastMonth).slice(0, 7), startDate: dayString(lastMonth), endDate: dayString(addDays(monthStart(todayUtc()), -1)) }}
              fields={[
                { name: "name", label: t("finance.fields.name"), required: true, maxLength: 60 },
                { name: "startDate", label: t("finance.budgets.periodStart"), type: "date", required: true },
                { name: "endDate", label: t("finance.budgets.periodEnd"), type: "date", required: true },
              ]}
            />
          </div>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.accounting.tabs.periods")} />
        {!periods.length ? (
          <Empty>{t("finance.periods.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.budgets.period")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {periods.map((x) => (
                <Tr key={x.id}>
                  <Td className="font-medium">{x.name}</Td>
                  <Td className="whitespace-nowrap">
                    {day(x.startDate)} – {day(x.endDate)}
                  </Td>
                  <Td>
                    <StatusBadge tone={x.status === "CLOSED" ? "neutral" : "success"}>{t(`finance.periods.statuses.${x.status}`)}</StatusBadge>
                    {x.closedAt ? <span className="ms-2 text-xs text-muted-foreground">{formatDateTime(x.closedAt, locale, p.tz)}</span> : null}
                  </Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex justify-end gap-1">
                        <ActionButton endpoint={`${base}/periods/${x.id}`} method="PATCH" body={{ status: x.status === "OPEN" ? "CLOSED" : "OPEN" }} label={x.status === "OPEN" ? t("finance.periods.close") : t("finance.periods.reopen")} confirm={x.status === "OPEN" ? t("finance.periods.confirmClose") : undefined} />
                        {x.status === "OPEN" ? <ActionButton endpoint={`${base}/periods/${x.id}`} method="DELETE" label={t("finance.delete")} variant="ghost" /> : null}
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
