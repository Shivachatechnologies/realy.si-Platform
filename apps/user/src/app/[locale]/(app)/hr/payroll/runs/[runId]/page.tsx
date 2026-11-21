import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrFrame, loadHr, personName, Stat } from "@/components/hr/shell";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getRun } from "@/server/modules/hr/payroll";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.payroll.run") };
}

const RUN_TONE = { DRAFT: "neutral", COMPUTED: "accent", APPROVED: "warning", PAID: "success" } as const;

export default async function PayrollRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.payrollRead;
  const frame = { t, locale, title: t("hr.payroll.run"), tab: "payroll" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const run = await getRun(viewer.ctx, org.id, company.id, runId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const manage = access!.payrollManage;
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: run.currency }, locale);
  const action = `${base}/hr/payroll/runs/${run.id}`;
  return (
    <HrFrame
      {...frame}
      title={t("hr.payroll.runFor", { period: run.period.name })}
      subtitle={`${formatDate(run.period.startDate, locale, "UTC")} – ${formatDate(run.period.endDate, locale, "UTC")} · ${t("hr.payroll.payDateIs", { date: formatDate(run.period.payDate, locale, "UTC") })}`}
      actions={
        <>
          <Badge tone={RUN_TONE[run.status]}>{t(`hr.runStatus.${run.status}`)}</Badge>
          {manage && (run.status === "DRAFT" || run.status === "COMPUTED") ? <ActionButton endpoint={action} body={{ action: "compute" }} label={run.status === "DRAFT" ? t("hr.payroll.compute") : t("hr.payroll.recompute")} variant="default" busyLabel={t("hr.payroll.computing")} /> : null}
          {manage && run.status === "COMPUTED" ? <ActionButton endpoint={action} body={{ action: "approve" }} label={t("hr.payroll.approve")} confirm={t("hr.payroll.approveConfirm")} /> : null}
          {manage && run.status === "APPROVED" ? (
            <>
              <ActionButton endpoint={action} body={{ action: "pay" }} label={t("hr.payroll.markPaid")} variant="default" confirm={t("hr.payroll.payConfirm")} />
              <ActionButton endpoint={action} body={{ action: "reopen" }} label={t("hr.payroll.reopen")} variant="ghost" />
            </>
          ) : null}
          {run.payslips.length ? (
            <Button asChild variant="secondary" size="sm">
              <a href={`${action}/export`}>
                <Download aria-hidden />
                {t("hr.payroll.exportCsv")}
              </a>
            </Button>
          ) : null}
          <Link href={`/${locale}/hr/payroll`} className="text-sm text-muted-foreground hover:underline">
            {t("hr.payroll.title")}
          </Link>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("hr.payroll.payslips")} value={run.payslips.length} />
        <Stat label={t("hr.payroll.gross")} value={money(run.totalGrossMinor)} />
        <Stat label={t("hr.payroll.deductions")} value={money(run.totalDeductionsMinor)} />
        <Stat label={t("hr.payroll.net")} value={money(run.totalNetMinor)} hint={[run.computedAt ? t("hr.payroll.computedAt", { date: formatDateTime(run.computedAt, locale, tz) }) : null, run.paidAt ? t("hr.payroll.paidAt", { date: formatDateTime(run.paidAt, locale, tz) }) : null].filter(Boolean).join(" · ") || undefined} />
      </div>
      <Card>
        <CardHeader title={t("hr.payroll.payslips")} description={run.status === "DRAFT" ? t("hr.payroll.computeHint") : undefined} />
        {run.payslips.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.employee")}</Th>
                <Th className="hidden md:table-cell">{t("hr.department")}</Th>
                <Th className="text-end">{t("hr.payroll.base")}</Th>
                <Th className="text-end">{t("hr.payroll.gross")}</Th>
                <Th className="text-end">{t("hr.payroll.deductions")}</Th>
                <Th className="text-end">{t("hr.payroll.net")}</Th>
              </Tr>
            </THead>
            <TBody>
              {run.payslips.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/${locale}/hr/payroll/payslips/${p.id}`} className="font-medium hover:underline">
                      {personName(p.employee)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{p.employee.title}</div>
                  </Td>
                  <Td className="hidden md:table-cell">{p.employee.department?.name ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{money(p.baseMinor)}</Td>
                  <Td className="text-end tabular-nums">{money(p.grossMinor)}</Td>
                  <Td className="text-end tabular-nums">{money(p.deductionsMinor)}</Td>
                  <Td className="text-end font-medium tabular-nums">{money(p.netMinor)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("hr.payroll.noPayslips")}</p>
        )}
      </Card>
    </HrFrame>
  );
}
