import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { documentOptions } from "@/components/finance/billing-data";
import { DocumentForm } from "@/components/finance/document-form";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.invoices.new") };
}

export default async function NewInvoicePage({ searchParams }: PageProps<"/[locale]/finance/invoices/new">) {
  const p = await financePage("invoices");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  if (!p.canManage) return p.frame(<Notice tone="warning">{t("errors.forbidden")}</Notice>);
  const opts = await documentOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive"));
  const customer = (await searchParams).customer;
  const accountId = typeof customer === "string" && opts.customers.some((c) => c.value === customer) ? customer : "";
  return p.frame(
    <Card>
      <CardHeader title={t("finance.invoices.new")} description={t("finance.invoices.newHint")} />
      <CardBody>
        <DocumentForm kind="invoice" base={base} locale={locale} currency={company.baseCurrency} customers={opts.customers} taxRates={opts.taxRates} initial={{ accountId }} />
      </CardBody>
    </Card>,
  );
}
