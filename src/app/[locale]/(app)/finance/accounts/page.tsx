import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, Kpi, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { dayString, fromMinor } from "@/server/modules/finance/common";
import { FINANCE_ACCOUNT_TYPES, listFinanceAccounts } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.accounts") };
}

export default async function AccountsPage() {
  const p = await financePage("accounts");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base } = p;
  const accounts = await listFinanceAccounts(viewer.ctx, org.id, company.id, { includeArchived: true });
  const active = accounts.filter((a) => !a.archivedAt);
  const total = active.reduce((s, a) => s + a.balanceMinor, 0n);
  const fields: FieldSpec[] = [
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 120 },
    { name: "type", label: t("finance.accounts.type"), type: "select", options: FINANCE_ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`finance.accounts.types.${x}`) })) },
    { name: "institution", label: t("finance.accounts.institution"), maxLength: 120 },
    { name: "numberLast4", label: t("finance.accounts.last4"), maxLength: 4, placeholder: "1234" },
    { name: "openingBalance", label: t("finance.accounts.openingBalance"), type: "amount", hint: t("finance.accounts.openingHint") },
    { name: "openingDate", label: t("finance.accounts.openingDate"), type: "date" },
  ];
  const byType = (type: string) => active.filter((a) => a.type === type).reduce((s, a) => s + a.balanceMinor, 0n);

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t("finance.accounts.totalBalance")} value={money(total)} />
        <Kpi label={t("finance.accounts.types.BANK")} value={money(byType("BANK"))} />
        <Kpi label={t("finance.accounts.types.CASH")} value={money(byType("CASH"))} />
        <Kpi label={t("finance.accounts.types.CARD")} value={money(byType("CARD"))} />
      </div>
      {p.canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.accounts.add")}</summary>
            <div className="border-t p-4">
              <ResourceForm endpoint={`${base}/accounts`} fields={fields} initial={{ type: "BANK", openingBalance: "0", openingDate: dayString(new Date()) }} submitLabel={t("finance.accounts.add")} />
            </div>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.tabs.accounts")} description={t("finance.accounts.hint")} />
        {!accounts.length ? (
          <Empty>{t("finance.accounts.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.accounts.type")}</Th>
                <Th>{t("finance.accounts.institution")}</Th>
                <Th>{t("finance.accounts.ledger")}</Th>
                <Th className="text-end">{t("finance.accounts.balance")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <Tr key={a.id} className={a.archivedAt ? "opacity-60" : undefined}>
                  <Td>
                    <Link href={`/${locale}/finance/transactions?account=${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    {a.numberLast4 ? <span className="ms-2 text-xs text-muted-foreground">•••• {a.numberLast4}</span> : null}
                    {a.archivedAt ? <StatusBadge tone="neutral">{t("status.ARCHIVED")}</StatusBadge> : null}
                  </Td>
                  <Td>{t(`finance.accounts.types.${a.type}`)}</Td>
                  <Td className="text-muted-foreground">{a.institution ?? "—"}</Td>
                  <Td className="text-muted-foreground">
                    <Link href={`/${locale}/finance/accounting/ledger/${a.ledgerAccountId}`} className="hover:underline">
                      {a.ledgerAccount.code} · {a.ledgerAccount.name}
                    </Link>
                  </Td>
                  <Td className={`text-end font-medium tabular-nums ${a.balanceMinor < 0n ? "text-danger" : ""}`}>{money(a.balanceMinor, a.currency)}</Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex justify-end gap-1">
                        <FormDialog trigger={t("finance.edit")} title={t("finance.accounts.edit")}>
                          <ResourceForm
                            endpoint={`${base}/accounts/${a.id}`}
                            method="PATCH"
                            fields={fields}
                            initial={{ name: a.name, type: a.type, institution: a.institution ?? "", numberLast4: a.numberLast4 ?? "", openingBalance: fromMinor(a.openingBalanceMinor, a.currency), openingDate: dayString(a.openingDate) }}
                            submitLabel={t("common.save")}
                          />
                        </FormDialog>
                        <ActionButton endpoint={`${base}/accounts/${a.id}`} method="PATCH" body={{ archived: !a.archivedAt }} label={a.archivedAt ? t("finance.restore") : t("finance.archive")} variant="ghost" />
                        {!a.archivedAt ? (
                          <Link href={`/${locale}/finance/accounting/reconciliation?account=${a.id}`} className="self-center px-2 text-xs hover:underline">
                            {t("finance.accounts.reconcile")}
                          </Link>
                        ) : null}
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
