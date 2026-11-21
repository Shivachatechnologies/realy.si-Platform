import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Clock, Gauge, Hourglass, PauseOctagon, Play, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { ModePicker, type Mode } from "@/components/autopilot/mode-picker";
import { PauseAllControl } from "@/components/autonomy/company-switches";
import { LiveRefresh } from "@/components/autonomy/log-actions";
import { PageState } from "@/components/workforce/states";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getAutopilotRoom, type AutopilotRoom } from "@/server/modules/autopilot/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("autopilot.title") };
}

const MODE_TONE: Record<Mode, "neutral" | "info" | "warning" | "success" | "danger"> = { OFF: "danger", MANUAL: "neutral", ASSISTED: "info", APPROVAL_REQUIRED: "warning", AUTONOMOUS: "success" };

/**
 * Company Autopilot control page: the company mode and each department's mode (Off · Manual · Assisted · Approval
 * required · Autonomous) with schedule windows, "pause everything", each department's live state from real tasks
 * and department autopilots, and the persistent log of every proactive start or hold-back.
 */
export default async function AutopilotPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <PageHeader variant="editorial" world="command" eyebrow={t("autopilot.eyebrow")} title={t("autopilot.title")} description={t("autopilot.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  let room: AutopilotRoom;
  try {
    room = await getAutopilotRoom(viewer.ctx, org.id, company.id);
  } catch (err) {
    if (isAppError(err) && (err.code === "forbidden" || err.code === "not_found")) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="danger" title={t("autopilot.error.title")}>
          {t("autopilot.error.body")}
        </Notice>
      </div>
    );
  }

  const base = `/api/v1/organizations/${org.id}/companies/${company.id}/autopilot`;
  const when = (iso: string) => formatDateTime(iso, locale, room.timezone);
  const dept = (d: string) => t(`workforce.departments.${d}`);
  const windowText = (w: { days: number[]; from: string | null; to: string | null }) => {
    if (!w.days.length && !w.from) return null;
    const days = w.days.length ? [...w.days].sort().map((d) => t(`autopilot.days.${d}`)).join(" ") : t("autopilot.window.anyTime");
    return w.from && w.to ? t("autopilot.window.summary", { days, from: w.from, to: w.to }) : t("autopilot.window.summaryDays", { days });
  };
  const anyAutonomous = room.company.mode === "AUTONOMOUS" || room.departments.some((d) => d.mode === "AUTONOMOUS");
  const companyWindow = windowText(room.company.window);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      <LiveRefresh />

      {!room.platform.aiEnabled ? <Notice tone="danger">{t("autopilot.notices.platformDisabled")}</Notice> : null}
      {room.platform.executionPaused ? <Notice tone="warning">{t("autopilot.notices.platformPaused")}</Notice> : null}
      {room.platform.backgroundPaused ? <Notice tone="warning">{t("autopilot.notices.backgroundPaused")}</Notice> : null}
      {room.paused ? (
        <Notice tone="danger" title={t("autonomy.pause.bannerTitle")} action={<PauseAllControl path={`${base}/pause`} paused canManage={canManage} />}>
          {room.pausedAt ? t("autonomy.pause.banner", { date: when(room.pausedAt) }) : null}
          {room.pauseReason ? ` ${t("autonomy.pause.reason", { reason: room.pauseReason })}` : null}
        </Notice>
      ) : null}
      {anyAutonomous && !room.autoModeEnabled ? (
        <Notice
          tone="info"
          action={
            <Link className="text-sm font-medium text-primary hover:underline" href={`/${locale}/autonomy`}>
              {t("autopilot.notices.openAutonomy")}
            </Link>
          }
        >
          {t("autopilot.notices.autoModeOff")}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card variant="highlight">
          <CardHeader
            title={t("autopilot.company.title")}
            description={t("autopilot.company.description")}
            icon={<Gauge />}
            actions={
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={MODE_TONE[room.company.mode]} shape="pill">
                  {t(`autopilot.modes.${room.company.mode}`)}
                </Badge>
                {room.company.source === "default" ? <Badge tone="neutral">{t("autopilot.derived")}</Badge> : null}
              </span>
            }
          />
          <CardBody className="grid gap-3">
            <ModePicker
              path={base}
              department="*"
              current={(room.company.own?.mode as Mode | undefined) ?? null}
              allowInherit={false}
              window={{ days: room.company.own?.windowDays ?? [], from: room.company.own?.windowFrom ?? null, to: room.company.own?.windowTo ?? null }}
              canManage={canManage}
            />
            {companyWindow ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />
                {companyWindow} · {room.company.inWindow ? t("autopilot.window.inside") : t("autopilot.window.outside")}
              </p>
            ) : null}
            {!canManage ? <p className="text-xs text-muted-foreground">{t("autopilot.readOnly")}</p> : null}
          </CardBody>
        </Card>
        <div className="grid gap-4">
          <Card>
            <CardHeader title={t("autopilot.pause.title")} description={t("autopilot.pause.explain")} icon={<PauseOctagon />} />
            <CardBody>{room.paused ? <Badge tone="danger" pulse>{t("autonomy.pause.isPaused")}</Badge> : <PauseAllControl path={`${base}/pause`} paused={false} canManage={canManage} />}</CardBody>
          </Card>
          <Card variant="immersive">
            <CardHeader title={t("autopilot.idle.title")} icon={<Hourglass />} />
            <CardBody className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t("autopilot.idle.body")}</p>
              <div className="flex flex-wrap gap-3 text-sm">
                <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`/${locale}/costs`}>
                  <Wallet className="size-4" aria-hidden />
                  {t("autopilot.links.costs")}
                </Link>
                <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`/${locale}/autonomy`}>
                  <ShieldCheck className="size-4" aria-hidden />
                  {t("autopilot.links.autonomy")}
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <StatGrid>
        <StatTile index={0} label={t("autopilot.stats.running")} value={room.stats.running} icon={<Play />} live hint={t("autopilot.stats.runningHint")} />
        <StatTile index={1} label={t("autopilot.stats.queued")} value={room.stats.queued} icon={<Hourglass />} hint={t("autopilot.stats.queuedHint")} />
        <StatTile index={2} label={t("autopilot.stats.started")} value={room.stats.started24h} icon={<Sparkles />} hint={t("autopilot.stats.startedHint")} />
        <StatTile index={3} label={t("autopilot.stats.blocked")} value={room.stats.blocked24h} icon={<PauseOctagon />} hint={t("autopilot.stats.blockedHint")} />
      </StatGrid>

      <section className="grid gap-3" aria-labelledby="autopilot-departments">
        <div className="grid gap-1">
          <h2 id="autopilot-departments" className="font-display text-xl tracking-tight">
            {t("autopilot.departments.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("autopilot.departments.subtitle")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {room.departments.map((d) => {
            const busy = d.running + d.queued > 0;
            const w = windowText(d.window);
            return (
              <Card key={d.key} className="flex flex-col">
                <div className="flex flex-wrap items-start justify-between gap-2 p-4 pb-2">
                  <div className="grid min-w-0 gap-0.5">
                    <h3 className="flex items-center gap-2 font-medium">
                      <StatusDot tone={d.mode === "OFF" ? "danger" : busy ? "success" : "neutral"} pulse={d.running > 0} />
                      {dept(d.key)}
                    </h3>
                    <p className="text-xs text-muted-foreground">{t("autopilot.dept.employees", { count: d.employees })}</p>
                  </div>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={MODE_TONE[d.mode]} shape="pill">
                      {t(`autopilot.modes.${d.mode}`)}
                    </Badge>
                    {d.source !== "department" ? <Badge tone="neutral">{t("autopilot.inherited")}</Badge> : null}
                  </span>
                </div>
                <div className="grid gap-2 px-4 pb-3 text-sm">
                  <p className="text-xs text-muted-foreground">{t(`autopilot.ceiling.${d.ceiling ?? "none"}`)}</p>
                  {busy || d.done24h || d.failed24h ? (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular">
                      {d.running ? <span className="text-success">{t("autopilot.dept.running", { count: d.running })}</span> : null}
                      {d.queued ? <span>{t("autopilot.dept.queued", { count: d.queued })}</span> : null}
                      <span className="text-muted-foreground">{t("autopilot.dept.done", { count: d.done24h })}</span>
                      {d.failed24h ? <span className="text-danger">{t("autopilot.dept.failed", { count: d.failed24h })}</span> : null}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("autopilot.dept.idle")}</p>
                  )}
                  {d.lastActivityAt ? <p className="text-xs text-muted-foreground">{t("autopilot.dept.lastActivity", { date: when(d.lastActivityAt) })}</p> : null}
                  {w ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3.5" aria-hidden />
                      {w} · {d.inWindow ? t("autopilot.window.inside") : t("autopilot.window.outside")}
                    </p>
                  ) : null}
                  {d.autopilots.length ? (
                    <ul className="grid gap-1.5 border-t pt-2">
                      {d.autopilots.map((a) => (
                        <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <StatusDot tone={a.state === "running" ? "success" : a.state === "failed" ? "danger" : a.state === "skipped" ? "warning" : "neutral"} />
                            <span className="font-medium">{t(`autopilot.autopilots.${a.key}`)}</span>
                            <span className="text-muted-foreground">{t("autopilot.autopilots.line", { active: a.active, total: a.total })}</span>
                          </span>
                          {a.lastRunAt ? <span className="text-muted-foreground">{t("autopilot.autopilots.lastRun", { date: when(a.lastRunAt) })}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <details className="group mt-auto border-t">
                  <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">{t("autopilot.change")}</summary>
                  <div className="px-4 pb-4">
                    <ModePicker
                      path={base}
                      department={d.key}
                      current={(d.own?.mode as Mode | undefined) ?? null}
                      allowInherit
                      window={{ days: d.own?.windowDays ?? [], from: d.own?.windowFrom ?? null, to: d.own?.windowTo ?? null }}
                      canManage={canManage}
                      compact
                    />
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader title={t("autopilot.log.title")} description={t("autopilot.log.description")} icon={<Activity />} actions={<Badge tone="success" pulse>{t("autonomy.log.live")}</Badge>} />
        {room.log.length ? (
          <ul className="divide-y">
            {room.log.map((r) => (
              <li key={r.id} className="grid gap-1 px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusDot tone={r.status === "STARTED" ? "success" : "warning"} />
                  <span className="font-medium">{r.status === "STARTED" ? t("autopilot.log.started") : t("autopilot.log.blocked")}</span>
                  {r.title ? <span className="min-w-0 break-words">{r.title}</span> : null}
                </p>
                <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{when(r.createdAt)}</span>
                  <span>{dept(r.department)}</span>
                  <span>{t(`autopilot.log.triggers.${r.trigger}`)}</span>
                  <span>{t(`autopilot.modes.${r.mode}`)}</span>
                  {r.reason ? <span className="text-warning">{t(`autopilot.log.reasons.${r.reason}`)}</span> : null}
                  {r.taskId ? (
                    <Link className="text-primary hover:underline" href={`/${locale}/tasks/${r.taskId}`}>
                      {t("autopilot.log.task")}
                    </Link>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("autopilot.log.empty")}</p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
