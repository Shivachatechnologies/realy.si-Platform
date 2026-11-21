import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/hr/hr-action";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getPayslip } from "@/server/modules/hr/payroll";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.payroll.payslip") };
}

/** Payslip: the employee's own (approved/paid runs) or anyone's with payroll.read. Printable. */
export default async function PayslipPage({ params }: { params: Promise<{ payslipId: string }> }) {
  const { payslipId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access } = await loadHr(locale);
  const allowed = !!access?.read || !!access?.payrollRead;
  if (!company || !allowed) return <HrFrame t={t} locale={locale} title={t("hr.payroll.payslip")} tab="me" access={access} hasCompany={!!company} allowed={allowed}>{null}</HrFrame>;
  const slip = await getPayslip(viewer.ctx, org.id, company.id, payslipId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: slip.currency }, locale);
  const earnings = slip.lines.filter((l) => l.kind === "EARNING");
  const deductions = slip.lines.filter((l) => l.kind === "DEDUCTION");
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/${locale}${access?.payrollRead ? `/hr/payroll/runs/${slip.runId}` : "/hr/me"}`} className="text-sm text-muted-foreground hover:underline">
          {t("hr.back")}
        </Link>
        <PrintButton label={t("hr.print")} />
      </div>
      <article className="grid gap-4 rounded-lg border bg-surface p-6 print:border-0">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t("hr.payroll.payslip")}</h1>
            <p className="text-sm text-muted-foreground">{slip.company.legalName || slip.company.name}</p>
          </div>
          <div className="text-end text-sm">
            <p className="font-medium">{slip.run.period.name}</p>
            <p className="text-muted-foreground">
              {formatDate(slip.run.period.startDate, locale, "UTC")} – {formatDate(slip.run.period.endDate, locale, "UTC")}
            </p>
            <p className="text-muted-foreground">{t("hr.payroll.payDateIs", { date: formatDate(slip.run.period.payDate, locale, "UTC") })}</p>
          </div>
        </header>
        <div className="grid gap-1 text-sm">
          <p className="font-medium">{personName(slip.employee)}</p>
          <p className="text-muted-foreground">{[slip.employee.title, slip.employee.department?.name, slip.employee.employeeNumber].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("hr.payroll.earnings")}</h2>
            <ul className="grid gap-1 text-sm">
              {earnings.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span>{l.label}</span>
                  <span className="tabular-nums">{money(l.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("hr.payroll.deductions")}</h2>
            <ul className="grid gap-1 text-sm">
              {deductions.length ? (
                deductions.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span>{l.label}</span>
                    <span className="tabular-nums">−{money(l.amountMinor)}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">—</li>
              )}
            </ul>
          </section>
        </div>
        <div className="grid gap-1 border-t pt-3 text-sm">
          <p className="flex justify-between">
            <span>{t("hr.payroll.gross")}</span>
            <span className="tabular-nums">{money(slip.grossMinor)}</span>
          </p>
          <p className="flex justify-between">
            <span>{t("hr.payroll.deductions")}</span>
            <span className="tabular-nums">−{money(slip.deductionsMinor)}</span>
          </p>
          <p className="flex justify-between text-base font-semibold">
            <span>{t("hr.payroll.net")}</span>
            <span className="tabular-nums">{money(slip.netMinor)}</span>
          </p>
        </div>
      </article>
    </div>
  );
}
