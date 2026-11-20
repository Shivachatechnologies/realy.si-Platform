import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ObjectiveBar } from "@/components/command/objective-bar";
import { MarkReadButton } from "@/components/command/mark-read-button";
import { listMyNotifications } from "@/server/modules/notifications/service";
import { LiveClock } from "@/components/live-clock";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatList, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { redis } from "@/server/core/rate-limit";
import { listAuditLogs } from "@/server/modules/audit/service";
import { MetricTile } from "@/components/bi/metric-tile";
import { formatChange, formatMetric } from "@/components/bi/format";
import { resolveRange } from "@/server/modules/bi/range";
import { metricContext, metricValues, type MetricValue } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("command.title") };
}

async function health(orgId: string) {
  const [database, queue, backlog] = await Promise.all([
    db().$queryRaw`SELECT 1`.then(() => true, () => false),
    redis().ping().then((r) => r === "PONG", () => false),
    db().event.count({ where: { organizationId: orgId, publishedAt: null } }).catch(() => null),
  ]);
  return { database, queue, backlog };
}

/** Department order for the Command Center KPI strip (most business-critical first). */
const KPI_ORDER = ["finance", "sales", "marketing", "support", "projects", "hr", "operations", "executive", "ai"];

/** Up to 8 KPIs for the last 30 days vs the previous 30, or null when the viewer may not read analytics. */
async function businessKpis(ctx: Parameters<typeof can>[0], orgId: string, companyId: string | null, chain: Awaited<ReturnType<typeof companyChain>> | null): Promise<{ values: MetricValue[]; currency: string } | null> {
  if (!companyId || !chain || !(await can(ctx, "analytics.read", chain))) return null;
  const { scope, metrics } = await metricContext(ctx, orgId, companyId);
  const picked = [...metrics].sort((a, b) => KPI_ORDER.indexOf(a.department) - KPI_ORDER.indexOf(b.department)).slice(0, 8);
  return { values: await metricValues(picked, scope, resolveRange("30d")), currency: scope.currency };
}

export default async function CommandCenterPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);

  // Real counts from the company's records, each shown only to viewers allowed to read that area.
  const chain = company ? await companyChain(db(), org.id, company.id) : null;
  const scoped = { organizationId: org.id, companyId: company?.id ?? "" };
  const countIf = async (permission: string, count: () => Promise<number>) => (chain && (await can(viewer.ctx, permission, chain)) ? count() : null);
  const [activity, status, billing, memberCount, taskCount, objectiveCount, approvalCount, notifications, aiEmployeeCount, kpis] = await Promise.all([
    listAuditLogs(viewer.ctx, org.id, { limit: 8 }).catch(() => null),
    health(org.id),
    db().billingProfile.findUnique({ where: { organizationId: org.id }, select: { billingCountryConfirmedAt: true } }),
    db().membership.count({ where: { organizationId: org.id, status: "ACTIVE" } }),
    countIf("agents.read", () => db().agentTask.count({ where: { ...scoped, status: { in: ["QUEUED", "RUNNING"] } } })),
    countIf("objectives.read", () => db().objective.count({ where: { ...scoped, status: "ACTIVE" } })),
    countIf("approvals.read", () => db().approval.count({ where: { ...scoped, status: "PENDING", expiresAt: { gt: new Date() } } })),
    listMyNotifications(viewer.ctx, org.id, { unreadOnly: true, limit: 10 }),
    countIf("agents.read", () => db().aiEmployee.count({ where: { ...scoped, archivedAt: null, status: "ACTIVE" } })),
    businessKpis(viewer.ctx, org.id, company?.id ?? null, chain),
  ]);

  const country = (code: string | null) => (code ? displayName(code, "region", locale) : t("command.notSet"));
  const setup = [
    { key: "company", done: !!company, href: "/company" },
    { key: "billing", done: !!billing?.billingCountryConfirmedAt, href: "/settings/billing" },
    { key: "mfa", done: viewer.user.mfaEnabled, href: "/settings/security" },
    { key: "team", done: memberCount > 1, href: "/settings/members" },
  ];
  const counters: { key: string; phase?: number; value?: number | null; href?: string }[] = [
    { key: "objectives", value: objectiveCount, href: "/objectives" },
    { key: "tasks", value: taskCount, href: "/tasks" },
    { key: "aiEmployees", value: aiEmployeeCount, href: "/workforce" },
    { key: "approvals", value: approvalCount, href: "/approvals" },
  ];

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t("command.title")}</h1>
        {company ? <span className="truncate text-xs text-muted-foreground">{company.name}</span> : null}
      </div>

      <ObjectiveBar />

      {notifications.length ? (
        <Card>
          <CardHeader
            title={t("notifications.title")}
            actions={
              <span className="flex items-center gap-2">
                <Link href={`/${locale}/notifications`} className="text-xs text-muted-foreground hover:underline">
                  {t("notifications.viewAll")}
                </Link>
                <MarkReadButton organizationId={org.id} />
              </span>
            }
          />
          <CardBody>
            <ul className="grid gap-1.5 text-sm">
              {notifications.map((n) => {
                const p = n.payload as { summary?: string; title?: string; href?: string };
                const href = n.type === "approval.requested" ? "/approvals" : p.href?.startsWith("/") ? p.href : "";
                return (
                  <li key={n.id}>
                    <Link className="hover:underline" href={`/${locale}${href}`}>
                      {n.type === "approval.requested"
                        ? t("notifications.approvalRequested", { summary: p.summary ?? "" })
                        : t(`notifications.kinds.${n.type}`, { title: p.title ?? "" })}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={t("command.business")}
          description={kpis ? t("command.kpisLast30") : undefined}
          actions={
            kpis ? (
              <Link href={`/${locale}/analytics`} className="text-xs text-primary hover:underline">
                {t("command.openAnalytics")}
              </Link>
            ) : null
          }
        />
        {kpis === null ? (
          <CardBody className="text-sm text-muted-foreground">{company ? t("command.kpisForbidden") : t("command.noCompany")}</CardBody>
        ) : kpis.values.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("command.kpisEmpty")}</CardBody>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-8">
            {kpis.values.map((m) => (
              <MetricTile
                key={m.key}
                label={t(m.labelKey)}
                value={formatMetric(m.value, m.unit, locale, kpis.currency, { compact: true })}
                change={formatChange(m.changePct, locale)}
                trend={m.trend}
                href={m.href ? `/${locale}${m.href}` : `/${locale}/analytics`}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("command.intelligence")} />
          <CardBody className="grid grid-cols-2 gap-3">
            {counters.map((c) => (
              <div key={c.key} className="grid gap-1 rounded-md border bg-surface-2 p-3">
                <span className="text-xs text-muted-foreground">{t(`command.counters.${c.key}`)}</span>
                {c.phase ? (
                  <>
                    <span className="tabular text-xl font-semibold text-muted-foreground/60">—</span>
                    <Badge className="w-fit">{t("common.comingInPhase", { phase: c.phase })}</Badge>
                  </>
                ) : (
                  <Link href={`/${locale}${c.href}`} className="tabular text-xl font-semibold hover:underline">
                    {c.value ?? "—"}
                  </Link>
                )}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("command.companyProfile")} />
          <CardBody>
            {company ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("command.incorporation")}</dt>
                <dd>{country(company.incorporationCountryCode)}</dd>
                <dt className="text-muted-foreground">{t("command.operating")}</dt>
                <dd>{company.operatingCountryCodes.length ? formatList(company.operatingCountryCodes.map(country), locale) : t("command.notSet")}</dd>
                <dt className="text-muted-foreground">{t("command.targets")}</dt>
                <dd>{company.targetMarketCodes.length ? formatList(company.targetMarketCodes.map(country), locale) : t("command.notSet")}</dd>
                <dt className="text-muted-foreground">{t("command.baseCurrency")}</dt>
                <dd>{displayName(company.baseCurrency, "currency", locale)} <span className="font-mono text-xs text-muted-foreground">{company.baseCurrency}</span></dd>
                <dt className="text-muted-foreground">{t("command.localTime")}</dt>
                <dd>
                  <LiveClock timeZone={company.timezone} /> <span className="font-mono text-xs text-muted-foreground">{company.timezone}</span>
                </dd>
                <dt className="text-muted-foreground">{t("command.dataRegion")}</dt>
                <dd>{t(`onboarding.dataRegions.${company.dataRegion}`)}</dd>
              </dl>
            ) : (
              <div className="grid justify-items-start gap-3">
                <p className="text-muted-foreground">{t("command.noCompany")}</p>
                <Button asChild size="sm">
                  <Link href={`/${locale}/company`}>{t("command.createCompany")}</Link>
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("command.setup")} />
          <CardBody>
            <ul className="grid gap-2">
              {setup.map((s) => (
                <li key={s.key}>
                  <Link href={`/${locale}${s.href}`} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
                    {s.done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
                    <span className={s.done ? "text-muted-foreground line-through" : undefined}>{t(`command.setupItems.${s.key}`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("command.activity")} />
          {activity && activity.data.length > 0 ? (
            <ol className="divide-y">
              {activity.data.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                  <StatusDot tone={a.category === "SECURITY" ? "warning" : "neutral"} />
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="truncate text-xs text-muted-foreground">{a.resourceType}</span>
                  <time className="ms-auto shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()}>
                    {formatRelativeTime(a.createdAt, locale)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <CardBody className="text-muted-foreground">{t("command.activityEmpty")}</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title={t("command.systemHealth")} />
          <CardBody className="grid gap-2">
            {(["database", "queue"] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <StatusDot tone={status[k] ? "success" : "danger"} />
                <span>{t(`command.health.${k}`)}</span>
                <span className="ms-auto text-xs text-muted-foreground">{t(status[k] ? "command.health.ok" : "command.health.fail")}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <StatusDot tone={status.backlog === null ? "danger" : status.backlog > 100 ? "warning" : "success"} />
              <span>{t("command.health.backlog")}</span>
              <span className="tabular ms-auto font-mono text-xs">{status.backlog ?? "—"}</span>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
