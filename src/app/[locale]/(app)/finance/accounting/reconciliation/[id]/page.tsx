import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AccountingTabs } from "@/components/finance/finance-tabs";
import { financePage } from "@/components/finance/page-context";
import { ReconcileTicker } from "@/components/finance/reconcile";
import { ActionButton, FormDialog, ResourceForm } from "@/components/finance/ui";
import { Kpi, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { dayString, fromMinor } from "@/server/modules/finance/common";
import { getReconciliation } from "@/server/modules/finance/transactions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.accounting.tabs.reconciliation") };
}

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("accounting");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const r = await getReconciliation(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const open = r.status === "IN_PROGRESS";
  const editable = open && p.canManage;
  return p.frame(
    <>
      <AccountingTabs locale={locale} active="reconciliation" t={t} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/accounting/reconciliation`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.accounting.tabs.reconciliation")}
        </Link>
        <h2 className="text-base font-semibold">{r.financeAccount.name}</h2>
        <span className="text-sm text-muted-foreground">{t("finance.reconciliation.statementOf", { date: day(r.statementDate) })}</span>
        <StatusBadge tone={open ? "warning" : "success"}>{t(`finance.reconciliation.statuses.${r.status}`)}</StatusBadge>
        {editable ? (
          <span className="ms-auto flex flex-wrap gap-2">
            <FormDialog trigger={t("finance.reconciliation.editStatement")} title={t("finance.reconciliation.editStatement")}>
              <ResourceForm
                endpoint={`${base}/reconciliations/${r.id}`}
                method="PATCH"
                extra={{ action: "update" }}
                reset={false}
                initial={{ statementDate: dayString(r.statementDate), endingBalance: fromMinor(r.endingBalanceMinor, r.financeAccount.currency) }}
                fields={[
                  { name: "statementDate", label: t("finance.reconciliation.statementDate"), type: "date", required: true },
                  { name: "endingBalance", label: t("finance.reconciliation.endingBalance"), type: "amount", required: true },
                ]}
                submitLabel={t("common.save")}
              />
            </FormDialog>
            <ActionButton endpoint={`${base}/reconciliations/${r.id}`} method="PATCH" body={{ action: "complete" }} label={t("finance.reconciliation.complete")} variant="default" />
            <ActionButton endpoint={`${base}/reconciliations/${r.id}`} method="DELETE" label={t("finance.reconciliation.cancel")} variant="ghost" confirm={t("finance.reconciliation.confirmCancel")} redirectTo={`/${locale}/finance/accounting/reconciliation`} />
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t("finance.reconciliation.startBalance")} value={money(r.startBalance)} />
        <Kpi label={t("finance.reconciliation.endingBalance")} value={money(r.endingBalanceMinor)} />
        <Kpi label={t("finance.reconciliation.cleared")} value={money(r.clearedBalance)} />
        <Kpi label={t("finance.reconciliation.difference")} value={money(r.difference)} tone={r.difference === 0n ? "success" : "danger"} />
      </div>
      {open && r.difference !== 0n ? <Notice>{t("finance.reconciliation.differenceHint")}</Notice> : null}
      <Card>
        <CardHeader title={open ? t("finance.reconciliation.unreconciled") : t("finance.reconciliation.reconciledItems")} description={t("finance.count", { count: r.candidates.length })} />
        {r.candidates.length ? (
          <ReconcileTicker
            base={base}
            id={r.id}
            editable={editable}
            rows={r.candidates.map((c) => ({
              id: c.id,
              date: day(c.date),
              description: c.description,
              detail: [c.reference, c.category?.name, c.account?.name].filter(Boolean).join(" · "),
              amount: money(c.signedMinor, c.currency),
              negative: c.signedMinor < 0n,
              ticked: c.ticked,
            }))}
          />
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("finance.reconciliation.noCandidates")}</p>
          </CardBody>
        )}
      </Card>
    </>,
  );
}
