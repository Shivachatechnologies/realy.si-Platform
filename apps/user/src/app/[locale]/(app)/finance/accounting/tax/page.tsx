import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { listTaxRates } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.tax") };
}

export default async function TaxPage() {
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  const rates = await listTaxRates(viewer.ctx, org.id, company.id, { includeArchived: true });
  const fields: FieldSpec[] = [
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 60, placeholder: "VAT 20%" },
    { name: "rate", label: t("finance.tax.rate"), type: "number", required: true, min: 0, max: 100, step: "any" },
    { name: "inclusive", label: t("finance.tax.inclusiveLabel"), type: "checkbox" },
  ];
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="tax" t={t} />
      {p.canManage ? (
        <Card>
          <CardHeader title={t("finance.tax.new")} description={t("finance.tax.hint")} />
          <div className="p-4">
            <ResourceForm endpoint={`${base}/tax-rates`} fields={fields} submitLabel={t("finance.tax.new")} />
          </div>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.accounting.tabs.tax")} />
        {!rates.length ? (
          <Empty>{t("finance.tax.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th className="text-end">{t("finance.tax.rate")}</Th>
                <Th>{t("finance.tax.mode")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {rates.map((r) => (
                <Tr key={r.id} className={r.archivedAt ? "opacity-60" : undefined}>
                  <Td className="font-medium">
                    {r.name} {r.archivedAt ? <StatusBadge tone="neutral">{t("status.ARCHIVED")}</StatusBadge> : null}
                  </Td>
                  <Td className="text-end tabular-nums">{r.rateBps / 100}%</Td>
                  <Td>{r.inclusive ? t("finance.tax.inclusive") : t("finance.tax.exclusive")}</Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex justify-end gap-1">
                        <FormDialog trigger={t("finance.edit")} title={r.name} variant="ghost">
                          <ResourceForm endpoint={`${base}/tax-rates/${r.id}`} method="PATCH" fields={fields} initial={{ name: r.name, rate: String(r.rateBps / 100), inclusive: r.inclusive }} submitLabel={t("common.save")} />
                        </FormDialog>
                        <ActionButton endpoint={`${base}/tax-rates/${r.id}`} method="PATCH" body={{ archived: !r.archivedAt }} label={r.archivedAt ? t("finance.restore") : t("finance.archive")} variant="ghost" />
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
