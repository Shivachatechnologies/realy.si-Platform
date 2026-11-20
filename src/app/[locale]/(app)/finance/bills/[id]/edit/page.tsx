import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { billOptions, billToValues } from "@/components/finance/bill-data";
import { BillForm } from "@/components/finance/bill-form";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { getBill } from "@/server/modules/finance/payables";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.bills.edit") };
}

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("bills");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  if (!p.canManage) return p.frame(<Notice tone="warning">{t("errors.forbidden")}</Notice>);
  const bill = await getBill(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  if (bill.status !== "DRAFT") redirect(`/${locale}/finance/bills/${bill.id}`);
  const options = await billOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive"));
  return p.frame(
    <Card>
      <CardHeader
        title={t("finance.bills.editTitle", { number: bill.number })}
        actions={
          <Link href={`/${locale}/finance/bills/${bill.id}`} className="text-xs text-muted-foreground hover:underline">
            {t("common.cancel")}
          </Link>
        }
      />
      <CardBody>
        <BillForm base={base} locale={locale} currency={bill.currency} options={options} initial={billToValues(bill)} id={bill.id} />
      </CardBody>
    </Card>,
  );
}
