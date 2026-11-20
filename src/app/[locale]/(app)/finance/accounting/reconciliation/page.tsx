import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { financePage } from "@/components/finance/page-context";
import { ResourceForm } from "@/components/finance/ui";
import { Empty, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { dayString, isUuid, param } from "@/server/modules/finance/common";
import { listFinanceAccounts } from "@/server/modules/finance/setup";
import { listReconciliations } from "@/server/modules/finance/transactions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.reconciliation") };
}

export default async function ReconciliationsPage({ searchParams }: PageProps<"/[locale]/finance/accounting/reconciliation">) {
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const preset = param(await searchParams, "account");
  const [list, accounts] = await Promise.all([listReconciliations(viewer.ctx, org.id, company.id), listFinanceAccounts(viewer.ctx, org.id, company.id)]);
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="reconciliation" t={t} />
      {p.canManage ? (
        <Card>
          <CardHeader title={t("finance.reconciliation.start")} description={t("finance.reconciliation.hint")} />
          <div className="p-4">
            {accounts.length ? (
              <ResourceForm
                endpoint={`${base}/reconciliations`}
                submitLabel={t("finance.reconciliation.start")}
                redirectTo={`/${locale}/finance/accounting/reconciliation/:id`}
                initial={{ financeAccountId: isUuid(preset) && accounts.some((a) => a.id === preset) ? preset : (accounts[0]?.id ?? ""), statementDate: dayString(new Date()) }}
                fields={[
                  { name: "financeAccountId", label: t("finance.fields.account"), type: "select", required: true, options: accounts.map((a) => ({ value: a.id, label: a.name })) },
                  { name: "statementDate", label: t("finance.reconciliation.statementDate"), type: "date", required: true },
                  { name: "endingBalance", label: t("finance.reconciliation.endingBalance"), type: "amount", required: true },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("finance.transactions.needAccount")}</p>
            )}
          </div>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.accounting.tabs.reconciliation")} />
        {!list.length ? (
          <Empty>{t("finance.reconciliation.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.account")}</Th>
                <Th>{t("finance.reconciliation.statementDate")}</Th>
                <Th className="text-end">{t("finance.reconciliation.endingBalance")}</Th>
                <Th className="text-end">{t("finance.reconciliation.items")}</Th>
                <Th>{t("common.status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/${locale}/finance/accounting/reconciliation/${r.id}`} className="font-medium hover:underline">
                      {r.financeAccount.name}
                    </Link>
                  </Td>
                  <Td>{day(r.statementDate)}</Td>
                  <Td className="text-end tabular-nums">{money(r.endingBalanceMinor)}</Td>
                  <Td className="text-end tabular-nums">{r._count.transactions}</Td>
                  <Td>
                    <StatusBadge tone={r.status === "COMPLETED" ? "success" : "warning"}>{t(`finance.reconciliation.statuses.${r.status}`)}</StatusBadge>
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
