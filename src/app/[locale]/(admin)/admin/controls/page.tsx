import Link from "next/link";
import { Bot, Building2, CircleSlash, Cog, DoorClosed, History, Layers, PauseCircle, PenOff, Siren, UserPlus, Workflow, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, Avatar, EmptyState, guard } from "@/components/admin/kit";
import { ControlListEditor, ControlValueEditor, KillSwitchCard, LockdownControl } from "@/components/admin/control-editors";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { CONTROL_DEFS, PLATFORM_MODULES, isControlKey, type ControlKey } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
import { listControls, settingRows } from "@/server/modules/admin/controls";
import { PROVIDERS } from "@/server/modules/integrations/catalog";
import { requestTime, requireViewer } from "@/server/session";

type SwitchKey = "maintenanceMode" | "readOnlyMode" | "aiWorkforceEnabled" | "aiExecutionPaused" | "registrationsEnabled" | "companyCreationEnabled" | "automationsEnabled" | "backgroundJobsPaused";

const EMERGENCY: SwitchKey[] = ["maintenanceMode", "readOnlyMode"];
const KILL: SwitchKey[] = ["aiWorkforceEnabled", "aiExecutionPaused", "automationsEnabled", "backgroundJobsPaused", "registrationsEnabled", "companyCreationEnabled"];
const ICON: Record<SwitchKey, React.ReactNode> = {
  maintenanceMode: <Wrench />,
  readOnlyMode: <PenOff />,
  aiWorkforceEnabled: <Bot />,
  aiExecutionPaused: <PauseCircle />,
  registrationsEnabled: <UserPlus />,
  companyCreationEnabled: <Building2 />,
  automationsEnabled: <Workflow />,
  backgroundJobsPaused: <Cog />,
};
const LOCKED_BY_LOCKDOWN = new Set<string>(["maintenanceMode", "aiWorkforceEnabled", "backgroundJobsPaused"]);

/** Platform Controls: global kill switches with real enforcement, reasons, typed confirmation and audit. */
export default async function PlatformControlsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listControls(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const { controls } = r.value;
  const [canManage, rows] = await Promise.all([canPlatform(viewer.ctx, "platform.controls.manage"), settingRows()]);
  const actors = await db().user.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.updatedById).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  const lockdown = controls.lockdown;
  const tz = viewer.user.timezone;
  const now = requestTime();
  const base = `/${locale}/admin`;
  const all = [...EMERGENCY, ...KILL];
  const isAbnormal = (k: SwitchKey) => controls[k] !== CONTROL_DEFS[k].default;
  const changed = all.filter(isAbnormal);

  const card = (key: SwitchKey) => {
    const value = controls[key] as boolean;
    const normal = CONTROL_DEFS[key].default as boolean;
    const abnormal = value !== normal;
    return (
      <KillSwitchCard
        key={key}
        controlKey={key}
        value={value}
        normal={normal}
        critical={CONTROL_DEFS[key].critical}
        canManage={canManage}
        locked={!!lockdown && LOCKED_BY_LOCKDOWN.has(key)}
        icon={ICON[key]}
        label={t(`admin.controls.keys.${key}.label`)}
        statusText={t(`admin.controls.cards.${key}.${abnormal ? "changed" : "normal"}`)}
        consequence={t(`admin.controls.cards.${key}.${abnormal ? "restore" : "flip"}`)}
      />
    );
  };
  const moduleLabels = Object.fromEntries(PLATFORM_MODULES.map((m) => [m, t(`admin.modules.${m}`)]));

  return (
    <div className="grid gap-5">
      <AdminHeader
        eyebrow={t("admin.title")}
        icon={<Siren />}
        title={t("admin.nav.controls")}
        description={t("admin.controls.subtitle")}
        why={t("admin.controls.why")}
        meta={
          <span className="inline-flex flex-wrap items-center gap-1.5" aria-label={t("admin.controls.summary", { changed: changed.length, total: all.length })}>
            {all.map((k) => (
              <LiveDot key={k} tone={isAbnormal(k) ? (CONTROL_DEFS[k].critical ? "danger" : "warning") : "success"} pulse={isAbnormal(k)} label={t(`admin.controls.keys.${k}.label`)} />
            ))}
            <span className="ms-1 text-xs text-muted-foreground">{t("admin.controls.summary", { changed: changed.length, total: all.length })}</span>
          </span>
        }
      />
      {!canManage ? <Notice tone="info">{t("admin.controls.readOnlyNotice")}</Notice> : null}

      {/* Emergency lockdown — a distinct panel */}
      <section
        aria-labelledby="lockdown-title"
        className={`control-room relative overflow-hidden rounded-xl border p-5 shadow-elev-3 ${lockdown ? "border-danger/60 bg-[color-mix(in_oklch,var(--danger)_14%,var(--background))]" : "bg-background"}`}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_18px,color-mix(in_oklch,var(--danger)_7%,transparent)_18px_36px)] opacity-60" />
        <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-danger/15 text-danger">
                <Siren className="size-5" />
              </span>
              <div>
                <h2 id="lockdown-title" className="flex items-center gap-2 text-base font-semibold">
                  {t("admin.controls.lockdown.title")}
                  {lockdown ? (
                    <Badge tone="danger" pulse>
                      {t("admin.controls.lockdown.activeBadge")}
                    </Badge>
                  ) : (
                    <Badge tone="success">{t("admin.controls.lockdown.readyBadge")}</Badge>
                  )}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {lockdown
                    ? t("admin.controls.lockdown.activeSince", { date: formatDateTime(lockdown.startedAt, locale, tz), sessions: lockdown.revokedSessions })
                    : t("admin.controls.lockdown.hint")}
                </p>
              </div>
            </div>
            {lockdown ? <blockquote className="rounded-md border border-danger/30 bg-surface/50 px-3 py-2 text-sm">“{lockdown.reason}”</blockquote> : null}
            <div>
              <LockdownControl active={!!lockdown} canManage={canManage} />
            </div>
          </div>
          <div className="rounded-lg border bg-surface/50 p-4">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{lockdown ? t("admin.controls.lockdown.recoveryTitle") : t("admin.controls.lockdown.effectsTitle")}</h3>
            <ol className="mt-2 grid gap-2 text-sm">
              {(lockdown ? (["investigate", "fix", "end", "inform"] as const) : (["maintenance", "ai", "jobs", "sessions"] as const)).map((s, i) => (
                <li key={s} className="flex gap-2.5">
                  <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${lockdown ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <span>
                    {t(`admin.controls.lockdown.${lockdown ? "steps" : "effects"}.${s}`)}
                    {lockdown && s === "investigate" ? (
                      <>
                        {" "}
                        <Link href={`${base}/security`} className="text-xs font-medium text-primary underline">
                          {t("admin.nav.security")}
                        </Link>{" "}
                        ·{" "}
                        <Link href={`${base}/audit`} className="text-xs font-medium text-primary underline">
                          {t("admin.nav.audit")}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section aria-labelledby="emergency-title" className="grid gap-3">
        <div>
          <h2 id="emergency-title" className="text-sm font-semibold">
            {t("admin.controls.groups.emergency")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("admin.controls.groups.emergencyHint")}</p>
        </div>
        <div className="stagger grid gap-3 md:grid-cols-2">{EMERGENCY.map(card)}</div>
        <Card>
          <ControlValueEditor controlKey="maintenanceMessage" kind="text" value={controls.maintenanceMessage} canManage={canManage} label={t("admin.controls.keys.maintenanceMessage.label")} description={t("admin.controls.keys.maintenanceMessage.hint")} />
        </Card>
      </section>

      <section aria-labelledby="kill-title" className="grid gap-3">
        <div>
          <h2 id="kill-title" className="text-sm font-semibold">
            {t("admin.controls.groups.kill")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("admin.controls.groups.killHint")}</p>
        </div>
        <div className="stagger grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{KILL.map(card)}</div>
      </section>

      <Card>
        <CardHeader icon={<Layers />} title={t("admin.controls.groups.modules")} description={t("admin.controls.groups.modulesHint")} />
        <div className="divide-y">
          <ControlListEditor
            controlKey="disabledModules"
            value={controls.disabledModules}
            options={[...PLATFORM_MODULES]}
            optionLabel={moduleLabels}
            canManage={canManage}
            label={t("admin.controls.keys.disabledModules.label")}
            description={t("admin.controls.keys.disabledModules.hint")}
          />
          <ControlListEditor
            controlKey="disabledIntegrations"
            value={controls.disabledIntegrations}
            options={PROVIDERS.map((p) => p.key)}
            optionLabel={Object.fromEntries(PROVIDERS.map((p) => [p.key, p.name]))}
            allowCustom
            canManage={canManage}
            label={t("admin.controls.keys.disabledIntegrations.label")}
            description={t("admin.controls.keys.disabledIntegrations.hint")}
          />
        </div>
      </Card>

      <Card>
        <CardHeader icon={<History />} title={t("admin.controls.history")} description={t("admin.controls.historyHint")} />
        {rows.length === 0 ? (
          <EmptyState icon={<CircleSlash />} title={t("admin.controls.noChanges")} body={t("admin.controls.noChangesHint")} />
        ) : (
          <ol className="divide-y">
            {rows.map((row) => {
              const email = actors.find((a) => a.id === row.updatedById)?.email ?? "—";
              const label = isControlKey(row.key) ? t(`admin.controls.keys.${row.key as ControlKey}.label`) : row.key;
              return (
                <li key={row.key} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <Avatar name={email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{label}</span>
                      <Badge className="max-w-60 truncate font-mono">{JSON.stringify(row.value).slice(0, 80)}</Badge>
                      <time dateTime={row.updatedAt.toISOString()} title={formatDateTime(row.updatedAt, locale, tz)} className="ms-auto text-xs text-muted-foreground">
                        {formatRelativeTime(row.updatedAt, locale, now)}
                      </time>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {email}
                      {row.reason ? <span className="text-foreground"> · “{row.reason}”</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <DoorClosed className="size-3.5" aria-hidden />
        {t("admin.controls.footerNote")}
      </p>
    </div>
  );
}
