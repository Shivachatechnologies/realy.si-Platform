import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { billOptions } from "@/components/finance/bill-data";
import { BillForm } from "@/components/finance/bill-form";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.bills.new") };
}

export default async function NewBillPage({ searchParams }: PageProps<"/[locale]/finance/bills/new">) {
  const p = await financePage("bills");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  if (!p.canManage) return p.frame(<Notice tone="warning">{t("errors.forbidden")}</Notice>);
  const options = await billOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive"));
  const vendor = (await searchParams).vendor;
  const vendorId = typeof vendor === "string" && options.vendors.some((v) => v.value === vendor) ? vendor : "";
  return p.frame(
    <Card>
      <CardHeader title={t("finance.bills.new")} description={t("finance.bills.newHint")} />
      <CardBody>
        <BillForm base={base} locale={locale} currency={company.baseCurrency} options={options} initial={{ vendorId }} />
      </CardBody>
    </Card>,
  );
}
