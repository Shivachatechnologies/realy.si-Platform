import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName, Stat } from "@/components/hr/shell";
import { formatDate, formatNumber } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { employeeOptions } from "@/server/modules/hr/employees";
import { FEEDBACK_KINDS, listCycles, myPendingReviews, performanceOverview } from "@/server/modules/hr/performance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.performance") };
}

const CYCLE_TONE = { DRAFT: "neutral", ACTIVE: "accent", CLOSED: "success" } as const;

export default async function PerformancePage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.perf.title"), subtitle: t("hr.perf.subtitle"), tab: "performance" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const manage = access!.manage;
  const [cycles, people, pending, overview] = await Promise.all([
    listCycles(viewer.ctx, org.id, company.id),
    employeeOptions(viewer.ctx, org.id, company.id),
    myPendingReviews(viewer.ctx, org.id, company.id),
    manage ? performanceOverview(viewer.ctx, org.id, company.id) : Promise.resolve(null),
  ]);
  const goalCount = (s: string) => overview?.goalsByStatus.find((g) => g.status === s)?._count._all ?? 0;
  return (
    <HrFrame {...frame}>
      {overview ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label={t("hr.perf.reviewsCompleted")} value={overview.avgRatings._count._all} />
          <Stat label={t("hr.perf.avgManagerRating")} value={overview.avgRatings._avg.managerRating ? formatNumber(overview.avgRatings._avg.managerRating, locale, { maximumFractionDigits: 1 }) : "—"} />
          <Stat label={t("hr.perf.goalsOnTrack")} value={goalCount("ON_TRACK") + goalCount("COMPLETED")} hint={t("hr.perf.goalsAtRisk", { count: goalCount("AT_RISK") })} />
          <Stat label={t("hr.perf.cyclesActive")} value={cycles.filter((c) => c.status === "ACTIVE").length} />
        </div>
      ) : null}
      {pending.self.length || pending.asReviewer.length ? (
        <Card>
          <CardHeader title={t("hr.perf.waitingForYou")} />
          <CardBody>
            <ul className="grid gap-1.5 text-sm">
              {pending.self.map((r) => (
                <li key={r.id}>
                  <Link href={`/${locale}/hr/me#reviews`} className="text-primary hover:underline">
                    {t("hr.perf.selfReviewFor", { cycle: r.cycle.name })}
                  </Link>
                </li>
              ))}
              {pending.asReviewer.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-2">
                  <Link href={`/${locale}/hr/employees/${r.employee.id}?tab=performance`} className="text-primary hover:underline">
                    {t("hr.perf.reviewOf", { name: personName(r.employee), cycle: r.cycle.name })}
                  </Link>
                  <Badge tone="warning">{t(`hr.reviewStatus.${r.status}`)}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.perf.cycles")} />
          {cycles.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.org.name")}</Th>
                  <Th>{t("hr.perf.dates")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="text-end">{t("hr.perf.completed")}</Th>
                </Tr>
              </THead>
              <TBody>
                {cycles.map((c) => (
                  <Tr key={c.id}>
                    <Td>{manage ? <Link href={`/${locale}/hr/performance/${c.id}`} className="font-medium hover:underline">{c.name}</Link> : c.name}</Td>
                    <Td className="text-xs">
                      {formatDate(c.startDate, locale, "UTC")} – {formatDate(c.endDate, locale, "UTC")}
                    </Td>
                    <Td>
                      <Badge tone={CYCLE_TONE[c.status]}>{t(`hr.cycleStatus.${c.status}`)}</Badge>
                    </Td>
                    <Td className="text-end">
                      {c.completed}/{c.total}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.perf.noCycles")}</p>
          )}
          {manage ? (
            <details className="border-t">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.perf.addCycle")}</summary>
              <HrForm
                className="px-3 pb-3"
                endpoint={`${base}/hr/review-cycles`}
                redirectTo="/hr/performance/:id"
                fields={[
                  { name: "name", label: t("hr.org.name"), required: true, placeholder: `${new Date().getUTCFullYear()} H2`, full: true },
                  { name: "startDate", label: t("hr.startDate"), type: "date", required: true },
                  { name: "endDate", label: t("hr.endDate"), type: "date", required: true },
                ]}
                submitLabel={t("common.create")}
              />
            </details>
          ) : null}
        </Card>
        <Card>
          <CardHeader title={t("hr.perf.giveFeedback")} description={t("hr.perf.feedbackHint")} />
          <CardBody>
            <HrForm
              columns={1}
              endpoint={`${base}/hr/feedback`}
              fields={[
                { name: "employeeId", label: t("hr.employee"), type: "select", required: true, options: peopleOptions(people.filter((p) => p.id !== access!.me?.id)) },
                { name: "kind", label: t("hr.perf.kind"), type: "select", required: true, options: enumOptions(t, "hr.feedbackKind", FEEDBACK_KINDS) },
                { name: "body", label: t("hr.perf.feedback"), type: "textarea", required: true, rows: 3 },
                { name: "isPrivate", label: t("hr.perf.private"), type: "checkbox", hint: t("hr.perf.privateHint") },
              ]}
              initial={{ kind: "PRAISE" }}
              submitLabel={t("hr.perf.send")}
              successMessage={t("hr.perf.feedbackSent")}
            />
          </CardBody>
        </Card>
        {overview?.recentFeedback.length ? (
          <Card className="lg:col-span-2">
            <CardHeader title={t("hr.perf.recentFeedback")} />
            <CardBody>
              <ul className="grid gap-2 text-sm">
                {overview.recentFeedback.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start gap-2">
                    <Badge tone={f.kind === "PRAISE" ? "success" : f.kind === "CONSTRUCTIVE" ? "warning" : "neutral"}>{t(`hr.feedbackKind.${f.kind}`)}</Badge>
                    <Link href={`/${locale}/hr/employees/${f.employee.id}?tab=performance`} className="font-medium hover:underline">
                      {personName(f.employee)}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.body}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(f.createdAt, locale, tz)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </HrFrame>
  );
}
