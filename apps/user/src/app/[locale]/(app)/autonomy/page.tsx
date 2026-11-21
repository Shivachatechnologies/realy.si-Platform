import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Lock, ShieldCheck, Sparkles, TrendingDown, Users } from "lucide-react";
import { AutonomyMeter } from "@/components/autonomy/autonomy-meter";
import { AutoModeSwitch, PauseAllControl } from "@/components/autonomy/company-switches";
import { LiveRefresh, ReportProblem } from "@/components/autonomy/log-actions";
import { PolicyRow, type Level, type RuleView } from "@/components/autonomy/policy-row";
import { ActionButton } from "@/components/workforce/action-button";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatMoney, minorUnits } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { AUTONOMY_CHANNELS, MONEY_CLASSES, NEVER_AUTO, PAYMENT_HARD_CAP_MAJOR, type ActionClass } from "@/server/modules/workforce/autonomy-classes";
import { getAutonomyRoom, type AutonomyRoom, type WireRule } from "@/server/modules/workforce/autonomy-service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("autonomy.title") };
}

/** Minor-unit string → plain major-unit string ("12345" USD → "123.45"), exact. */
function major(minor: string | null, currency: string): string | null {
  if (minor === null) return null;
  const d = minorUnits(currency);
  const s = minor.padStart(d + 1, "0");
  const whole = d ? s.slice(0, -d) : s;
  const frac = d ? s.slice(-d).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

function view(r: WireRule, base: string): RuleView {
  const currency = r.currency ?? base;
  return {
    level: r.level as Level,
    inherited: r.inherited,
    hasRow: !r.inherited && r.policyId !== null,
    dailyLimit: r.dailyLimit,
    perActionMax: major(r.perActionMaxMinor, currency),
    dailyMax: major(r.dailyMaxMinor, currency),
    monthlyMax: major(r.monthlyMaxMinor, currency),
    currency,
    hoursFrom: r.hoursFrom,
    hoursTo: r.hoursTo,
    allowedDays: r.allowedDays,
    allowedChannels: r.allowedChannels,
  };
}

/**
 * Autonomy control room: company Auto mode and "Pause all AI", plain-language rules per department and action class
 * (Off · Suggest · Ask me · Auto within limits), hard floors shown locked, trust records with one-click promotions,
 * and a live log of everything the AI did on its own, with undo where the action is reversible.
 */
export default async function AutonomyPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader eyebrow={t("autonomy.eyebrow")} title={t("autonomy.title")} subtitle={t("autonomy.subtitle")} />
      <WorkforceTabs locale={locale} active="autonomy" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  let room: AutonomyRoom;
  try {
    room = await getAutonomyRoom(viewer.ctx, org.id, company.id);
  } catch (err) {
    if (isAppError(err) && (err.code === "forbidden" || err.code === "not_found")) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="danger" title={t("autonomy.error.title")}>
          {t("autonomy.error.body")}
        </Notice>
      </div>
    );
  }

  const base = `/api/v1/organizations/${org.id}/companies/${company.id}/workforce/autonomy`;
  const dept = (d: string) => (d === "*" ? t("autonomy.company") : t(`workforce.departments.${d}`));
  const cls = (c: string) => t(`autonomy.classes.${c}`);
  const when = (iso: string) => formatDateTime(iso, locale, room.timezone);
  const paymentCap = formatMoney({ amountMinor: BigInt(room.paymentHardCapMinor), currency: room.baseCurrency }, locale);
  const levelLabels = { OFF: t("autonomy.levels.OFF"), SUGGEST: t("autonomy.levels.SUGGEST"), ASK: t("autonomy.levels.ASK"), AUTO: t("autonomy.levels.AUTO") };
  const hasRules = room.departments.some((d) => d.rules.some((r) => !r.rule.inherited));
  const external = room.trust.filter((l) => l.actionClass !== "read");

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      <LiveRefresh />

      {!room.platform.aiEnabled ? <Notice tone="danger">{t("autonomy.platform.disabled")}</Notice> : null}
      {room.platform.executionPaused ? <Notice tone="warning">{t("autonomy.platform.paused")}</Notice> : null}
      {room.platform.supervised ? <Notice tone="info">{t("autonomy.platform.supervised")}</Notice> : null}
      {room.settings.paused ? (
        <Notice tone="danger" title={t("autonomy.pause.bannerTitle")} action={<PauseAllControl path={`${base}/pause`} paused canManage={canManage} />}>
          {room.settings.pausedAt ? t("autonomy.pause.banner", { date: when(room.settings.pausedAt) }) : null}
          {room.settings.pauseReason ? ` ${t("autonomy.pause.reason", { reason: room.settings.pauseReason })}` : null}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card variant="highlight">
          <CardHeader title={t("autonomy.autoMode.title")} description={t("autonomy.autoMode.description")} icon={<Sparkles />} />
          <CardBody>
            <AutoModeSwitch path={base} enabled={room.settings.autoModeEnabled} canManage={canManage} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("autonomy.pause.title")} description={t("autonomy.pause.explain")} icon={<ShieldCheck />} />
          <CardBody className="grid gap-2">
            {room.settings.paused ? <Badge tone="danger" pulse>{t("autonomy.pause.isPaused")}</Badge> : <PauseAllControl path={`${base}/pause`} paused={false} canManage={canManage} />}
            {!canManage ? <p className="text-xs text-muted-foreground">{t("autonomy.readOnly")}</p> : null}
          </CardBody>
        </Card>
      </div>

      <StatGrid>
        <StatTile index={0} label={t("autonomy.stats.autoToday")} value={room.autoLast24h} icon={<Activity />} live hint={t("autonomy.stats.autoTodayHint")} />
        <StatTile index={1} label={t("autonomy.stats.recommendations")} value={room.recommendations.length} icon={<Sparkles />} hint={t("autonomy.stats.recommendationsHint")} />
        <StatTile index={2} label={t("autonomy.stats.employees")} value={room.departments[0]?.employees ?? 0} icon={<Users />} hint={t("autonomy.stats.employeesHint", { count: room.departments.length - 1 })} />
      </StatGrid>

      {!hasRules && !room.settings.autoModeEnabled ? (
        <Card variant="immersive">
          <CardHeader title={t("autonomy.guide.title")} description={t("autonomy.guide.description")} />
          <CardBody>
            <ol className="grid gap-3 sm:grid-cols-3">
              {(["step1", "step2", "step3"] as const).map((s, i) => (
                <li key={s} className="flex gap-3 rounded-lg border bg-surface/70 p-3 text-sm">
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary tabular">{i + 1}</span>
                  <span>{t(`autonomy.guide.${s}`)}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      {room.recommendations.length || room.demotions.length ? (
        <Card>
          <CardHeader title={t("autonomy.recommendations.title")} description={t("autonomy.recommendations.description")} icon={<Sparkles />} />
          <CardBody className="grid gap-3">
            {!room.settings.autoModeEnabled && room.recommendations.length ? <Notice tone="info">{t("autonomy.recommendations.autoModeOff")}</Notice> : null}
            <ul className="grid gap-2">
              {room.recommendations.map((r) => (
                <li key={`${r.department}-${r.actionClass}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-success/5 p-3">
                  <p className="min-w-0 text-sm">
                    {t("autonomy.recommendations.text", { department: dept(r.department), action: cls(r.actionClass), approved: r.approved, rejected: r.rejected, days: r.days, limit: r.dailyLimit })}
                  </p>
                  {canManage ? (
                    <ActionButton path={`${base}/recommendations`} body={{ department: r.department, actionClass: r.actionClass }} variant="default">
                      {t("autonomy.recommendations.apply", { limit: r.dailyLimit })}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
              {room.demotions.map((d) => (
                <li key={`demoted-${d.department}-${d.actionClass}`} className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning/5 p-3 text-sm">
                  <TrendingDown className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>{t("autonomy.demotions.text", { department: dept(d.department), action: cls(d.actionClass), date: when(d.at), reason: d.reason ?? "—" })}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <section className="grid gap-3" aria-labelledby="rules-title">
        <div className="grid gap-1">
          <h2 id="rules-title" className="font-display text-xl tracking-tight">
            {t("autonomy.rules.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("autonomy.rules.subtitle")}</p>
        </div>
        {room.departments.map((d, i) => {
          const counts = { OFF: 0, SUGGEST: 0, ASK: 0, AUTO: 0 };
          for (const r of d.rules) if (r.actionClass !== "read") counts[r.rule.level as Level]++;
          return (
            <details key={d.key} open={i === 0} className="group rounded-lg border bg-surface shadow-elev-1">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="grid gap-0.5">
                  <span className="font-medium">{dept(d.key)}</span>
                  <span className="text-xs text-muted-foreground">{d.key === "*" ? t("autonomy.companyHelp") : t("autonomy.rules.employees", { count: d.employees })}</span>
                </span>
                <AutonomyMeter counts={counts} size={56} labels={{ ...levelLabels, summary: t("autonomy.rules.meter", { auto: counts.AUTO, total: d.rules.length - 1 }) }} />
              </summary>
              <div className="border-t">
                {d.rules.map((r) => {
                  const c = r.actionClass as ActionClass;
                  const v = view(r.rule, room.baseCurrency);
                  const used =
                    r.rule.level === "AUTO" && c !== "read"
                      ? r.rule.dailyLimit
                        ? t("autonomy.rules.usedToday", { used: r.usedToday, limit: r.rule.dailyLimit })
                        : t("autonomy.rules.usedTodayNoLimit", { used: r.usedToday })
                      : null;
                  const spent = r.spentToday.map((s) => formatMoney({ amountMinor: BigInt(s.amountMinor), currency: s.currency }, locale)).join(" · ");
                  return (
                    <PolicyRow
                      key={c}
                      path={`${base}/policies`}
                      department={d.key}
                      actionClass={c}
                      rule={v}
                      locked={NEVER_AUTO.includes(c)}
                      isMoney={MONEY_CLASSES.includes(c)}
                      isRead={c === "read"}
                      isCompanyRow={d.key === "*"}
                      canManage={canManage}
                      usage={[used, spent ? t("autonomy.rules.spentToday", { amount: spent }) : null].filter(Boolean).join(" · ") || null}
                      paymentCap={c === "pay" ? paymentCap : null}
                    />
                  );
                })}
              </div>
            </details>
          );
        })}
      </section>

      <Card>
        <CardHeader title={t("autonomy.floors.title")} description={t("autonomy.floors.description")} icon={<Lock />} />
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[t("autonomy.floors.contract"), t("autonomy.floors.hr"), t("autonomy.floors.delete"), t("autonomy.floors.pay", { amount: paymentCap, major: PAYMENT_HARD_CAP_MAJOR }), t("autonomy.floors.founderOnly"), t("autonomy.floors.killSwitch")].map((f) => (
              <li key={f} className="flex items-start gap-2 rounded-md border bg-surface-2/60 p-2.5 text-sm">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("autonomy.trust.title")} description={t("autonomy.trust.description", { threshold: room.settings.demotionThreshold, days: room.settings.demotionWindowDays })} icon={<ShieldCheck />} />
        {external.length ? (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("autonomy.trust.department")}</Th>
                  <Th>{t("autonomy.trust.action")}</Th>
                  <Th>{t("autonomy.trust.approved")}</Th>
                  <Th>{t("autonomy.trust.rejected")}</Th>
                  <Th>{t("autonomy.trust.edited")}</Th>
                  <Th>{t("autonomy.trust.auto")}</Th>
                  <Th>{t("autonomy.trust.problems")}</Th>
                  <Th>{t("autonomy.trust.employees")}</Th>
                </Tr>
              </THead>
              <TBody>
                {external.map((l) => {
                  const problems = l.failed + l.undone + l.complaints + l.reversals;
                  return (
                    <Tr key={`${l.department}-${l.actionClass}`}>
                      <Td>{dept(l.department)}</Td>
                      <Td>{cls(l.actionClass)}</Td>
                      <Td className="tabular">{l.approved}</Td>
                      <Td className={l.rejected ? "tabular text-danger" : "tabular"}>{l.rejected}</Td>
                      <Td className="tabular">{l.edited}</Td>
                      <Td className="tabular">{l.autoDone}</Td>
                      <Td className={problems ? "tabular text-danger" : "tabular"}>{problems}</Td>
                      <Td className="text-xs text-muted-foreground">
                        {l.employees.slice(0, 3).map((e) => t("autonomy.trust.employeeLine", { name: e.name, approved: e.approved + e.autoDone, rejected: e.rejected })).join(" · ") || "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("autonomy.trust.empty")}</p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title={t("autonomy.log.title")} description={t("autonomy.log.description")} icon={<Activity />} actions={<Badge tone="success" pulse>{t("autonomy.log.live")}</Badge>} />
        {room.log.length ? (
          <ul className="divide-y">
            {room.log.map((a) => (
              <li key={a.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="grid min-w-0 gap-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusDot tone={a.status === "EXECUTED" ? "success" : a.status === "FAILED" ? "danger" : a.status === "UNDONE" ? "neutral" : "info"} pulse={a.status === "RUNNING"} />
                    <span className="min-w-0 break-words font-medium">{a.summary}</span>
                  </p>
                  <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{when(a.createdAt)}</span>
                    <span>{dept(a.department)}</span>
                    <span>{cls(a.actionClass)}</span>
                    {a.employee ? <span>{t("autonomy.log.by", { name: a.employee })}</span> : null}
                    {a.amountMinor && a.currency ? <span className="tabular">{formatMoney({ amountMinor: BigInt(a.amountMinor), currency: a.currency }, locale)}</span> : null}
                    {a.channel ? <span>{(AUTONOMY_CHANNELS as readonly string[]).includes(a.channel) ? t(`autonomy.channels.${a.channel}`) : a.channel}</span> : null}
                    <span>{a.policyScope === null ? t("autonomy.log.policyDefault") : t("autonomy.log.policy", { scope: dept(a.policyScope) })}</span>
                    {a.taskId ? (
                      <Link className="text-primary hover:underline" href={`/${locale}/tasks/${a.taskId}`}>
                        {t("autonomy.log.task")}
                      </Link>
                    ) : null}
                  </p>
                  {a.status === "FAILED" && a.error ? <p className="text-xs text-danger">{t("autonomy.log.failed", { error: a.error })}</p> : null}
                  {a.status === "UNDONE" && a.undoneAt ? <p className="text-xs text-muted-foreground">{t("autonomy.log.undone", { date: when(a.undoneAt) })}</p> : null}
                </div>
                {canManage && a.status !== "RUNNING" ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {a.reversible ? (
                      <ActionButton path={`${base}/actions/${a.id}/undo`} confirm={t("autonomy.log.undoConfirm")} variant="secondary">
                        {t("autonomy.log.undo")}
                      </ActionButton>
                    ) : a.status === "EXECUTED" ? (
                      <span className="text-xs text-muted-foreground">{t("autonomy.log.notReversible")}</span>
                    ) : null}
                    {a.status !== "UNDONE" ? <ReportProblem path={`${base}/actions/${a.id}/feedback`} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">{room.settings.autoModeEnabled ? t("autonomy.log.emptyOn") : t("autonomy.log.emptyOff")}</p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
