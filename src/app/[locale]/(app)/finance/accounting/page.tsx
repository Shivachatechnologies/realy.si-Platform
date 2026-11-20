import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { LEDGER_TYPES, listLedgerAccounts } from "@/server/modules/finance/ledger";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.chart") };
}

export default async function ChartOfAccountsPage() {
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base } = p;
  const accounts = await listLedgerAccounts(viewer.ctx, org.id, company.id, { includeArchived: true });
  const fields: FieldSpec[] = [
    { name: "code", label: t("finance.chart.code"), required: true, maxLength: 12 },
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 120 },
    { name: "type", label: t("finance.chart.type"), type: "select", options: LEDGER_TYPES.map((x) => ({ value: x, label: t(`finance.chart.types.${x}`) })) },
    { name: "description", label: t("finance.fields.description"), span: 3, maxLength: 500 },
  ];
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="chart" t={t} />
      {p.canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.chart.add")}</summary>
            <div className="border-t p-4">
              <ResourceForm endpoint={`${base}/ledger-accounts`} fields={fields} initial={{ type: "EXPENSE" }} submitLabel={t("finance.chart.add")} />
            </div>
          </details>
        </Card>
      ) : null}
      {LEDGER_TYPES.map((type) => {
        const rows = accounts.filter((a) => a.type === type);
        return (
          <Card key={type}>
            <CardHeader title={t(`finance.chart.types.${type}`)} description={money(rows.filter((a) => !a.archivedAt).reduce((s, a) => s + a.balanceMinor, 0n))} />
            <Table>
              <THead>
                <Tr>
                  <Th className="w-24">{t("finance.chart.code")}</Th>
                  <Th>{t("finance.fields.name")}</Th>
                  <Th className="text-end">{t("finance.chart.balance")}</Th>
                  <Th>
                    <span className="sr-only">{t("common.actions")}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <Tr key={a.id} className={a.archivedAt ? "opacity-60" : undefined}>
                    <Td className="font-mono">{a.code}</Td>
                    <Td>
                      <Link href={`/${locale}/finance/accounting/ledger/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      {a.systemKey ? <StatusBadge tone="neutral">{t("finance.chart.system")}</StatusBadge> : null}
                      {a.archivedAt ? <StatusBadge tone="neutral">{t("status.ARCHIVED")}</StatusBadge> : null}
                      {a.description ? <span className="block text-xs text-muted-foreground">{a.description}</span> : null}
                    </Td>
                    <Td className="text-end tabular-nums">{money(a.balanceMinor)}</Td>
                    <Td>
                      {p.canManage ? (
                        <div className="flex justify-end gap-1">
                          <FormDialog trigger={t("finance.edit")} title={`${a.code} ${a.name}`} variant="ghost">
                            <ResourceForm endpoint={`${base}/ledger-accounts/${a.id}`} method="PATCH" fields={fields} initial={{ code: a.code, name: a.name, type: a.type, description: a.description ?? "" }} submitLabel={t("common.save")} />
                          </FormDialog>
                          {!a.systemKey ? <ActionButton endpoint={`${base}/ledger-accounts/${a.id}`} method="PATCH" body={{ archived: !a.archivedAt }} label={a.archivedAt ? t("finance.restore") : t("finance.archive")} variant="ghost" /> : null}
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        );
      })}
    </>,
  );
}
