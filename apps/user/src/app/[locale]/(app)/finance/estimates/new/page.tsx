import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { documentOptions } from "@/components/finance/billing-data";
import { DocumentForm } from "@/components/finance/document-form";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.estimates.new") };
}

export default async function NewEstimatePage() {
  const p = await financePage("estimates");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  if (!p.canManage) return p.frame(<Notice tone="warning">{t("errors.forbidden")}</Notice>);
  const opts = await documentOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive"));
  return p.frame(
    <Card>
      <CardHeader title={t("finance.estimates.new")} />
      <CardBody>
        <DocumentForm kind="estimate" base={base} locale={locale} currency={company.baseCurrency} customers={opts.customers} taxRates={opts.taxRates} />
      </CardBody>
    </Card>,
  );
}
