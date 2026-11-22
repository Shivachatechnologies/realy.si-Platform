import { CalendarClock, Play } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, guard } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { EnvBadge } from "@/components/admin/env-badge";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { duration, ProductionNotice } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { canPlatform } from "@/server/modules/admin/access";
import { JOB_MANAGE_PERM, listSchedulers } from "@/server/core/job-admin";
import { isProduction, productionPhrase } from "@/server/modules/admin/releases";
import { requireViewer } from "@/server/session";

/** Scheduled and recurring jobs (BullMQ job schedulers registered by the worker) with run-now. */
export default async function SchedulesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listSchedulers(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const s = r.value;
  const canManage = await canPlatform(viewer.ctx, JOB_MANAGE_PERM);
  const prod = isProduction();
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.system.jobs.v2.schedules") }]} />
      <AdminHeader icon={<CalendarClock />} title={t("admin.system.jobs.v2.schedules")} description={t("admin.system.jobs.v2.schedulesSubtitle")} meta={<EnvBadge />} />
      {canManage ? <ProductionNotice production={prod} title={t("admin.system.env.productionTitle")} body={t("admin.system.env.productionBody")} /> : null}
      {!s.available ? <Notice tone="warning">{t("admin.system.jobs.v2.unavailable")}</Notice> : null}
      <Card>
        <CardHeader icon={<CalendarClock />} title={t("admin.system.jobs.v2.recurring")} description={t("admin.system.jobs.v2.recurringHint")} />
        {s.schedulers.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title={t("admin.system.jobs.v2.noSchedulers")} body={t("admin.system.jobs.v2.noSchedulersHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.system.jobs.v2.job")}</Th>
                  <Th>{t("admin.system.jobs.v2.every")}</Th>
                  <Th>{t("admin.system.jobs.v2.nextRun")}</Th>
                  <Th>{t("admin.system.jobs.v2.lastRun")}</Th>
                  <Th>{t("admin.system.jobs.v2.actions")}</Th>
                </Tr>
              </THead>
              <TBody>
                {s.schedulers.map((j) => (
                  <Tr key={j.name}>
                    <Td className="font-mono text-xs">{j.name}</Td>
                    <Td className="text-xs">{j.everyMs ? duration(j.everyMs, locale) : (j.pattern ?? "—")}</Td>
                    <Td className="text-xs">{j.nextRunAt ? <Timestamp value={j.nextRunAt} /> : "—"}</Td>
                    <Td className="text-xs">
                      {j.lastRun ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <StatusBadge domain="jobRun" value={j.lastRun.status}>
                            {t(`admin.system.jobs.status.${j.lastRun.status}`)}
                          </StatusBadge>
                          <Timestamp value={j.lastRun.at} mode="relative" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("admin.system.jobs.v2.noRecordedRun")}</span>
                      )}
                    </Td>
                    <Td>
                      {canManage ? (
                        <OpsAction label={t("admin.system.jobs.v2.runNow")} title={t("admin.system.jobs.v2.runNowTitle", { job: j.name })} description={t("admin.system.jobs.v2.runNowHint")} path={`/api/v1/admin/jobs/schedulers/${encodeURIComponent(j.name)}`} phrase={productionPhrase(`run ${j.name}`)} production={prod} icon={<Play aria-hidden />} variant="ghost" success={t("admin.system.jobs.v2.done")} />
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="px-4 py-2 text-xs text-muted-foreground">{t("admin.system.jobs.v2.lastRunHint")}</p>
      </Card>
    </div>
  );
}
