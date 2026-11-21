import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, namedOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName, Stat } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { COMPONENT_CALCS, COMPONENT_KINDS, compensationOverview, listPeriods, listRuns, listStructures, payrollReport } from "@/server/modules/hr/payroll";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.payroll") };
}

const VIEWS = ["runs", "compensation", "structures", "reports"] as const;
const RUN_TONE = { DRAFT: "neutral", COMPUTED: "accent", APPROVED: "warning", PAID: "success" } as const;

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.payrollRead;
  const frame = { t, locale, title: t("hr.payroll.title"), subtitle: t("hr.payroll.subtitle"), tab: "payroll" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const view = (VIEWS as readonly string[]).includes(String(raw.view)) ? (raw.view as (typeof VIEWS)[number]) : "runs";
  const manage = access!.payrollManage;
  const money = (m: bigint, c = company.baseCurrency) => formatMoney({ amountMinor: m, currency: c }, locale);
  let body: ReactNode = null;

  if (view === "runs") {
    const [runs, periods] = await Promise.all([listRuns(viewer.ctx, org.id, company.id), listPeriods(viewer.ctx, org.id, company.id)]);
    const openPeriods = periods.filter((p) => p.status === "OPEN" && !p.runs.some((r) => r.status !== "PAID"));
    body = (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("hr.payroll.runs")} />
          {runs.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.payroll.period")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="text-end">{t("hr.payroll.payslips")}</Th>
                  <Th className="text-end">{t("hr.payroll.gross")}</Th>
                  <Th className="text-end">{t("hr.payroll.net")}</Th>
                </Tr>
              </THead>
              <TBody>
                {runs.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/${locale}/hr/payroll/runs/${r.id}`} className="font-medium hover:underline">
                        {r.period.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{t("hr.payroll.payDateIs", { date: formatDate(r.period.payDate, locale, "UTC") })}</div>
                    </Td>
                    <Td>
                      <Badge tone={RUN_TONE[r.status]}>{t(`hr.runStatus.${r.status}`)}</Badge>
                    </Td>
                    <Td className="text-end">{r._count.payslips}</Td>
                    <Td className="text-end tabular-nums">{money(r.totalGrossMinor, r.currency)}</Td>
                    <Td className="text-end tabular-nums">{money(r.totalNetMinor, r.currency)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.payroll.noRuns")}</p>
          )}
          {manage && openPeriods.length ? (
            <div className="border-t p-3">
              <HrForm endpoint={`${base}/hr/payroll/runs`} redirectTo="/hr/payroll/runs/:id" columns={1} fields={[{ name: "periodId", label: t("hr.payroll.period"), type: "select", required: true, options: namedOptions(openPeriods) }]} submitLabel={t("hr.payroll.newRun")} />
            </div>
          ) : null}
        </Card>
        <Card>
          <CardHeader title={t("hr.payroll.periods")} />
          <CardBody className="grid gap-3">
            {periods.length ? (
              <ul className="grid gap-1 text-sm">
                {periods.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(p.startDate, locale, "UTC")} – {formatDate(p.endDate, locale, "UTC")}
                    </span>
                    <Badge tone={p.status === "OPEN" ? "accent" : "neutral"}>{t(`hr.periodStatus.${p.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.payroll.noPeriods")}</p>
            )}
            {manage ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.payroll.addPeriod")}</summary>
                <HrForm
                  className="mt-3"
                  columns={1}
                  endpoint={`${base}/hr/payroll/periods`}
                  fields={[
                    { name: "name", label: t("hr.org.name"), required: true, placeholder: new Date().toISOString().slice(0, 7) },
                    { name: "startDate", label: t("hr.startDate"), type: "date", required: true },
                    { name: "endDate", label: t("hr.endDate"), type: "date", required: true },
                    { name: "payDate", label: t("hr.payroll.payDate"), type: "date", required: true },
                  ]}
                  submitLabel={t("common.create")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  } else if (view === "compensation") {
    const [rows, structures] = await Promise.all([compensationOverview(viewer.ctx, org.id, company.id), manage ? listStructures(viewer.ctx, org.id, company.id) : Promise.resolve([])]);
    const missing = rows.filter((r) => !r.compensation).length;
    body = (
      <Card>
        <CardHeader title={t("hr.payroll.compensation")} description={missing ? t("hr.payroll.missingComp", { count: missing }) : undefined} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("hr.employee")}</Th>
              <Th className="hidden md:table-cell">{t("hr.department")}</Th>
              <Th className="text-end">{t("hr.payroll.baseMonthly")}</Th>
              <Th className="hidden sm:table-cell">{t("hr.payroll.structure")}</Th>
              <Th className="hidden sm:table-cell">{t("hr.payroll.effectiveFrom")}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map(({ employee: e, compensation: c }) => (
              <Tr key={e.id}>
                <Td>
                  <Link href={`/${locale}/hr/employees/${e.id}?tab=payroll`} className="font-medium hover:underline">
                    {personName(e)}
                  </Link>
                  <div className="text-xs text-muted-foreground">{e.title}</div>
                </Td>
                <Td className="hidden md:table-cell">{e.department?.name ?? "—"}</Td>
                <Td className="text-end tabular-nums">{c ? money(c.baseMonthlyMinor, c.currency) : <Badge tone="warning">{t("hr.payroll.notSet")}</Badge>}</Td>
                <Td className="hidden sm:table-cell">{c?.structure?.name ?? "—"}</Td>
                <Td className="hidden sm:table-cell">{c ? formatDate(c.effectiveFrom, locale, "UTC") : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {manage ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.payroll.addCompensation")}</summary>
            <HrForm
              className="px-3 pb-3"
              columns={3}
              endpoint={`${base}/hr/payroll/compensation`}
              fields={[
                { name: "employeeId", label: t("hr.employee"), type: "select", required: true, options: peopleOptions(rows.map((r) => r.employee)) },
                { name: "baseMonthly", label: t("hr.payroll.baseMonthly"), type: "money", required: true },
                { name: "currency", label: t("hr.currency"), placeholder: company.baseCurrency, maxLength: 3 },
                { name: "effectiveFrom", label: t("hr.payroll.effectiveFrom"), type: "date", required: true },
                { name: "structureId", label: t("hr.payroll.structure"), type: "select", options: namedOptions(structures) },
                { name: "note", label: t("hr.note") },
              ]}
              submitLabel={t("hr.add")}
            />
          </details>
        ) : null}
      </Card>
    );
  } else if (view === "structures") {
    const structures = await listStructures(viewer.ctx, org.id, company.id);
    body = (
      <div className="grid gap-4">
        {structures.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {structures.map((s) => (
              <Card key={s.id}>
                <CardHeader title={s.name} description={[s.description, t("hr.payroll.usedBy", { count: s._count.compensations })].filter(Boolean).join(" · ")} actions={manage ? <ActionButton endpoint={`${base}/hr/payroll/structures/${s.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.confirmArchive")} /> : null} />
                <CardBody className="grid gap-3">
                  {s.components.length ? (
                    <ul className="grid gap-1 text-sm">
                      {s.components.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2">
                          <Badge tone={c.kind === "ALLOWANCE" ? "success" : "warning"}>{t(`hr.componentKind.${c.kind}`)}</Badge>
                          <span>{c.name}</span>
                          <span className="text-xs text-muted-foreground">{c.calc === "PERCENT" ? t("hr.payroll.percentOfBase", { percent: (c.percentBp ?? 0) / 100 }) : money(c.amountMinor ?? 0n)}</span>
                          {manage ? <ActionButton endpoint={`${base}/hr/payroll/components/${c.id}`} method="DELETE" label="×" variant="ghost" /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("hr.payroll.noComponents")}</p>
                  )}
                  {manage ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-primary">{t("hr.payroll.addComponent")}</summary>
                      <HrForm
                        className="mt-2"
                        endpoint={`${base}/hr/payroll/structures/${s.id}/components`}
                        fields={[
                          { name: "name", label: t("hr.org.name"), required: true },
                          { name: "kind", label: t("hr.payroll.kind"), type: "select", required: true, options: enumOptions(t, "hr.componentKind", COMPONENT_KINDS) },
                          { name: "calc", label: t("hr.payroll.calc"), type: "select", required: true, options: enumOptions(t, "hr.componentCalc", COMPONENT_CALCS) },
                          { name: "amount", label: t("hr.payroll.fixedAmount", { currency: company.baseCurrency }), type: "money" },
                          { name: "percent", label: t("hr.payroll.percent"), placeholder: "10" },
                        ]}
                        initial={{ kind: "ALLOWANCE", calc: "FIXED" }}
                        submitLabel={t("hr.add")}
                      />
                    </details>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <p className="p-4 text-sm text-muted-foreground">{t("hr.payroll.noStructures")}</p>
          </Card>
        )}
        {manage ? (
          <Card>
            <CardHeader title={t("hr.payroll.addStructure")} />
            <CardBody>
              <HrForm
                endpoint={`${base}/hr/payroll/structures`}
                fields={[
                  { name: "name", label: t("hr.org.name"), required: true },
                  { name: "description", label: t("hr.org.description") },
                ]}
                submitLabel={t("common.create")}
              />
            </CardBody>
          </Card>
        ) : null}
      </div>
    );
  } else {
    const year = Number(typeof raw.year === "string" && /^\d{4}$/.test(raw.year) ? raw.year : new Date().getUTCFullYear());
    const report = await payrollReport(viewer.ctx, org.id, company.id, year);
    body = (
      <div className="grid gap-4">
        <div className="flex gap-3 text-sm">
          <Link href={`/${locale}/hr/payroll?view=reports&year=${year - 1}`} className="hover:underline">
            {year - 1}
          </Link>
          <span className="font-medium">{year}</span>
          <Link href={`/${locale}/hr/payroll?view=reports&year=${year + 1}`} className="hover:underline">
            {year + 1}
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t("hr.payroll.gross")} value={money(report.totals.gross)} />
          <Stat label={t("hr.payroll.deductions")} value={money(report.totals.deductions)} />
          <Stat label={t("hr.payroll.net")} value={money(report.totals.net)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("hr.payroll.byRun")} />
            {report.runs.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("hr.payroll.period")}</Th>
                    <Th className="text-end">{t("hr.payroll.payslips")}</Th>
                    <Th className="text-end">{t("hr.payroll.gross")}</Th>
                    <Th className="text-end">{t("hr.payroll.net")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {report.runs.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/${locale}/hr/payroll/runs/${r.id}`} className="hover:underline">
                          {r.period.name}
                        </Link>
                      </Td>
                      <Td className="text-end">{r._count.payslips}</Td>
                      <Td className="text-end tabular-nums">{money(r.totalGrossMinor, r.currency)}</Td>
                      <Td className="text-end tabular-nums">{money(r.totalNetMinor, r.currency)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("hr.payroll.noRuns")}</p>
            )}
          </Card>
          <Card>
            <CardHeader title={t("hr.payroll.byDepartment")} />
            {report.departments.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("hr.department")}</Th>
                    <Th className="text-end">{t("hr.payroll.payslips")}</Th>
                    <Th className="text-end">{t("hr.payroll.gross")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {report.departments.map((d) => (
                    <Tr key={d.name}>
                      <Td>{d.name}</Td>
                      <Td className="text-end">{d.count}</Td>
                      <Td className="text-end tabular-nums">{money(d.gross)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("hr.payroll.noRuns")}</p>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <HrFrame {...frame}>
      <Notice tone="info">{manage ? t("hr.payroll.mfaNote") : t("hr.payroll.readOnly")}</Notice>
      <nav className="flex gap-1 overflow-x-auto text-sm" aria-label={t("hr.payroll.title")}>
        {VIEWS.map((v) => (
          <Link key={v} href={`/${locale}/hr/payroll?view=${v}`} aria-current={view === v ? "page" : undefined} className={cn("shrink-0 rounded-md px-3 py-1.5", view === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
            {t(`hr.payroll.views.${v}`)}
          </Link>
        ))}
      </nav>
      {body}
    </HrFrame>
  );
}
