import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { financeSettings } from "@/server/modules/finance/common";
import { listLedgerAccounts } from "@/server/modules/finance/ledger";
import { listCategories, listCostCenters } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.settings") };
}

export default async function FinanceSettingsPage() {
  const p = await financePage("settings");
  if (p.blocked) return p.blocked;
  const { t, viewer, org, company, base } = p;
  const [settings, categories, costCenters, ledger, spend] = await Promise.all([
    financeSettings(db(), org.id, company.id),
    listCategories(viewer.ctx, org.id, company.id, { includeArchived: true }),
    listCostCenters(viewer.ctx, org.id, company.id),
    listLedgerAccounts(viewer.ctx, org.id, company.id),
    db().financeTransaction.groupBy({ by: ["departmentId"], where: { companyId: company.id, type: "EXPENSE", departmentId: { not: null } }, _sum: { amountMinor: true } }),
  ]);
  const spendBy = new Map(spend.map((s) => [s.departmentId, s._sum.amountMinor ?? 0n]));
  const ledgerOptions = ledger.filter((a) => a.type === "INCOME" || a.type === "EXPENSE" || a.type === "ASSET").map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const catFields: FieldSpec[] = [
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 80 },
    { name: "kind", label: t("finance.settings.kind"), type: "select", options: [{ value: "EXPENSE", label: t("finance.transactions.types.EXPENSE") }, { value: "INCOME", label: t("finance.transactions.types.INCOME") }] },
    { name: "ledgerAccountId", label: t("finance.settings.postsTo"), type: "select", emptyLabel: t("finance.settings.defaultLedger"), options: ledgerOptions },
  ];
  return p.frame(
    <>
      <Card>
        <CardHeader title={t("finance.settings.documents")} description={t("finance.settings.documentsHint")} />
        <div className="p-4">
          {p.canManage ? (
            <ResourceForm
              endpoint={`${base}/settings`}
              method="PUT"
              reset={false}
              submitLabel={t("common.save")}
              initial={{ invoicePrefix: settings.invoicePrefix, estimatePrefix: settings.estimatePrefix, creditNotePrefix: settings.creditNotePrefix, defaultDueDays: String(settings.defaultDueDays), invoiceFooter: settings.invoiceFooter ?? "" }}
              fields={[
                { name: "invoicePrefix", label: t("finance.settings.invoicePrefix"), maxLength: 12 },
                { name: "estimatePrefix", label: t("finance.settings.estimatePrefix"), maxLength: 12 },
                { name: "creditNotePrefix", label: t("finance.settings.creditNotePrefix"), maxLength: 12 },
                { name: "defaultDueDays", label: t("finance.settings.defaultDueDays"), type: "number", min: 0, max: 365, required: true },
                { name: "invoiceFooter", label: t("finance.settings.invoiceFooter"), type: "textarea", span: 2, maxLength: 2000, hint: t("finance.settings.invoiceFooterHint") },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {settings.invoicePrefix} · {settings.estimatePrefix} · {settings.creditNotePrefix} · {t("finance.settings.dueDaysValue", { count: settings.defaultDueDays })}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={t("finance.settings.categories")} description={t("finance.settings.categoriesHint")} />
        {p.canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.settings.addCategory")}</summary>
            <div className="border-t p-4">
              <ResourceForm endpoint={`${base}/categories`} fields={catFields} initial={{ kind: "EXPENSE" }} submitLabel={t("finance.settings.addCategory")} />
            </div>
          </details>
        ) : null}
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.fields.name")}</Th>
              <Th>{t("finance.settings.kind")}</Th>
              <Th>{t("finance.settings.postsTo")}</Th>
              <Th className="text-end">{t("finance.vendors.transactions")}</Th>
              <Th>
                <span className="sr-only">{t("common.actions")}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {categories.map((c) => (
              <Tr key={c.id} className={c.archivedAt ? "opacity-60" : undefined}>
                <Td className="font-medium">
                  {c.name} {c.archivedAt ? <StatusBadge tone="neutral">{t("status.ARCHIVED")}</StatusBadge> : null}
                </Td>
                <Td>{t(`finance.transactions.types.${c.kind}`)}</Td>
                <Td className="text-muted-foreground">{c.ledgerAccount ? `${c.ledgerAccount.code} · ${c.ledgerAccount.name}` : "—"}</Td>
                <Td className="text-end tabular-nums">{c._count.transactions}</Td>
                <Td>
                  {p.canManage ? (
                    <div className="flex justify-end gap-1">
                      <FormDialog trigger={t("finance.edit")} title={c.name} variant="ghost">
                        <ResourceForm endpoint={`${base}/categories/${c.id}`} method="PATCH" fields={catFields} initial={{ name: c.name, kind: c.kind, ledgerAccountId: c.ledgerAccountId ?? "" }} submitLabel={t("common.save")} />
                      </FormDialog>
                      <ActionButton endpoint={`${base}/categories/${c.id}`} method="PATCH" body={{ archived: !c.archivedAt }} label={c.archivedAt ? t("finance.restore") : t("finance.archive")} variant="ghost" />
                    </div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title={t("finance.settings.costCenters")} description={t("finance.settings.costCentersHint")} />
        {p.canManage ? (
          <div className="border-b p-4">
            <ResourceForm
              endpoint={`${base}/cost-centers`}
              submitLabel={t("finance.settings.addCostCenter")}
              fields={[
                { name: "name", label: t("finance.fields.name"), required: true, maxLength: 120 },
                { name: "costCenterCode", label: t("finance.settings.costCenterCode"), maxLength: 40 },
              ]}
            />
          </div>
        ) : null}
        {!costCenters.length ? (
          <Empty>{t("finance.settings.noCostCenters")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.settings.costCenterCode")}</Th>
                <Th>{t("finance.fields.name")}</Th>
                <Th className="text-end">{t("finance.settings.totalSpend")}</Th>
              </Tr>
            </THead>
            <TBody>
              {costCenters.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-mono">{d.costCenterCode ?? "—"}</Td>
                  <Td>{d.name}</Td>
                  <Td className="text-end tabular-nums">{p.money(spendBy.get(d.id) ?? 0n)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
