import type { Metadata } from "next";
import { DailyBars } from "@/components/enterprise/daily-bars";
import { LimitsForm } from "@/components/enterprise/limits-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { usageAnalytics } from "@/server/modules/enterprise/insights";
import { getOrgSettings } from "@/server/modules/enterprise/policy";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.usage") };
}

export default async function UsagePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  let u: Awaited<ReturnType<typeof usageAnalytics>>;
  try {
    u = await usageAnalytics(viewer.ctx, org.id);
  } catch (e) {
    if (isAppError(e) && ["forbidden", "mfa_required"].includes(e.code)) return <Notice tone="warning">{t(`errors.${e.code}`)}</Notice>;
    throw e;
  }
  const [canManage, settings] = await Promise.all([can(viewer.ctx, "organizations.manage", orgChain(org.id)), getOrgSettings(org.id)]);
  const n = (x: number) => formatNumber(x, locale);
  const compact = (x: number) => formatNumber(x, locale, { notation: "compact", maximumFractionDigits: 1 });
  const label = (day: string) =>
    formatDate(`${day}T12:00:00Z`, locale, "UTC", {
      month: "short",
      day: "numeric",
    });
  const series = (k: "tasks" | "tokens" | "apiCalls") => u.series.map((p) => ({ day: p.day, label: label(p.day), value: p[k] }));
  const meter = (used: number, limit: number | null) =>
    limit === null ? t("enterprise.usage.ofUnlimited", { used: n(used) }) : t("enterprise.usage.ofLimit", { used: n(used), limit: n(limit) });
  const counts = Object.entries(u.counts) as [keyof typeof u.counts, number][];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "members", used: u.counts.members, limit: u.limits.maxMembers },
          {
            k: "companies",
            used: u.counts.companies,
            limit: u.limits.maxCompanies,
          },
          {
            k: "aiTokensToday",
            used: u.tokensToday,
            limit: u.limits.maxAiTokensPerDay,
          },
          { k: "apiKeys", used: u.counts.apiKeys, limit: u.limits.maxApiKeys },
        ].map((m) => {
          const pct = m.limit ? Math.min(100, (m.used / Math.max(1, m.limit)) * 100) : 0;
          return (
            <Card key={m.k} className="grid gap-1 p-4">
              <p className="text-xs text-muted-foreground">{t(`enterprise.usage.meters.${m.k}`)}</p>
              <p className="text-xl font-semibold tabular">{n(m.used)}</p>
              <p className="text-xs text-muted-foreground">{meter(m.used, m.limit)}</p>
              {m.limit !== null ? (
                <div
                  className="h-1.5 overflow-hidden rounded bg-muted"
                  role="meter"
                  aria-valuenow={m.used}
                  aria-valuemin={0}
                  aria-valuemax={m.limit}
                  aria-label={t(`enterprise.usage.meters.${m.k}`)}
                >
                  <div className={`h-full rounded ${pct >= 90 ? "bg-danger" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title={t("enterprise.usage.last30")} description={t("enterprise.usage.last30Hint")} />
        <CardBody className="grid gap-6 lg:grid-cols-3">
          <DailyBars title={t("enterprise.usage.aiTasks")} points={series("tasks")} format={n} tableLabel={t("enterprise.usage.showTable")} dayLabel={t("enterprise.usage.day")} />
          <DailyBars
            title={t("enterprise.usage.aiTokens")}
            points={series("tokens")}
            format={compact}
            tableLabel={t("enterprise.usage.showTable")}
            dayLabel={t("enterprise.usage.day")}
          />
          <DailyBars
            title={t("enterprise.usage.apiCalls")}
            points={series("apiCalls")}
            format={n}
            tableLabel={t("enterprise.usage.showTable")}
            dayLabel={t("enterprise.usage.day")}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("enterprise.usage.dataTitle")} />
        <dl className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-4">
          {counts.map(([k, v]) => (
            <div key={k} className="bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t(`enterprise.usage.counts.${k}`)}</dt>
              <dd className="text-lg font-semibold tabular">{n(v)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <CardHeader
          title={t("enterprise.limits.title")}
          description={
            u.limits.plan.name
              ? t("enterprise.limits.planHint", {
                  plan: u.limits.plan.name,
                  companies: u.limits.plan.companiesMax === null ? "∞" : n(u.limits.plan.companiesMax),
                })
              : t("enterprise.limits.noPlan")
          }
        />
        <CardBody>
          {canManage ? (
            <LimitsForm
              orgId={org.id}
              initial={{
                maxMembers: settings.maxMembers,
                maxCompanies: settings.maxCompanies,
                maxWorkspacesPerCompany: settings.maxWorkspacesPerCompany,
                maxAiTokensPerDay: settings.maxAiTokensPerDay,
                maxApiKeys: settings.maxApiKeys,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("enterprise.limits.readOnly")}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
