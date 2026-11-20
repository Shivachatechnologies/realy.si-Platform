import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { enumParam } from "@/server/modules/hr/access";
import { employeeOptions } from "@/server/modules/hr/employees";
import { listRequests, REQUEST_STATUSES, REQUEST_TYPES } from "@/server/modules/hr/policies";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.requests") };
}

const TONE = { OPEN: "warning", IN_PROGRESS: "accent", RESOLVED: "success", REJECTED: "danger" } as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.requests.title"), subtitle: t("hr.requests.subtitle"), tab: "requests" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const status = enumParam(raw, "status", REQUEST_STATUSES);
  const manage = access!.manage;
  const [requests, people] = await Promise.all([listRequests(viewer.ctx, org.id, company.id, { status }), manage ? employeeOptions(viewer.ctx, org.id, company.id) : Promise.resolve([])]);
  return (
    <HrFrame {...frame}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={manage ? t("hr.requests.all") : t("hr.requests.mine")} description={t("hr.requests.count", { count: requests.length })} />
          <div className="flex flex-wrap gap-1 border-b px-3 py-2 text-xs">
            <Link href={`/${locale}/hr/requests`} className={cn("rounded px-2 py-0.5", !status ? "bg-muted" : "hover:bg-muted/60")}>
              {t("common.all")}
            </Link>
            {REQUEST_STATUSES.map((s) => (
              <Link key={s} href={`/${locale}/hr/requests?status=${s}`} className={cn("rounded px-2 py-0.5", status === s ? "bg-muted" : "hover:bg-muted/60")}>
                {t(`hr.requestStatus.${s}`)}
              </Link>
            ))}
          </div>
          {requests.length ? (
            <ul className="grid divide-y">
              {requests.map((r) => (
                <li key={r.id} className="grid gap-1 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.subject}</span>
                    <Badge>{t(`hr.requestType.${r.type}`)}</Badge>
                    <Badge tone={TONE[r.status]}>{t(`hr.requestStatus.${r.status}`)}</Badge>
                    {manage ? (
                      <Link href={`/${locale}/hr/employees/${r.employee.id}`} className="text-xs hover:underline">
                        {personName(r.employee)}
                      </Link>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{formatDate(r.createdAt, locale, tz)}</span>
                  </div>
                  {r.details ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{r.details}</p> : null}
                  {r.resolution ? <p className="text-xs">{t("hr.requests.resolutionIs", { text: r.resolution })}</p> : null}
                  {manage && (r.status === "OPEN" || r.status === "IN_PROGRESS") ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-primary">{t("hr.requests.handle")}</summary>
                      <HrForm
                        className="mt-2"
                        method="PATCH"
                        endpoint={`${base}/hr/requests/${r.id}`}
                        fields={[
                          { name: "status", label: t("common.status"), type: "select", required: true, options: enumOptions(t, "hr.requestStatus", REQUEST_STATUSES) },
                          { name: "resolution", label: t("hr.requests.resolution"), type: "textarea", rows: 2 },
                        ]}
                        initial={{ status: r.status === "OPEN" ? "IN_PROGRESS" : "RESOLVED", resolution: r.resolution }}
                        submitLabel={t("common.save")}
                      />
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.requests.empty")}</p>
          )}
        </Card>
        {access!.me || manage ? (
          <Card>
            <CardHeader title={t("hr.requests.new")} />
            <CardBody>
              <HrForm
                columns={1}
                endpoint={`${base}/hr/requests`}
                fields={[
                  ...(manage ? [{ name: "employeeId", label: t("hr.leave.forEmployee"), type: "select" as const, options: peopleOptions(people), hint: t("hr.leave.forEmployeeHint") }] : []),
                  { name: "type", label: t("hr.requests.type"), type: "select", required: true, options: enumOptions(t, "hr.requestType", REQUEST_TYPES) },
                  { name: "subject", label: t("hr.requests.subject"), required: true, maxLength: 200 },
                  { name: "details", label: t("hr.requests.details"), type: "textarea", rows: 4 },
                ]}
                initial={{ type: "equipment" }}
                submitLabel={t("hr.requests.submit")}
                successMessage={t("hr.requests.submitted")}
              />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </HrFrame>
  );
}
