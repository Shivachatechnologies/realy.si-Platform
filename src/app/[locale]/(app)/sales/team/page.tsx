import type { Metadata } from "next";
import Link from "next/link";
import { SalesRepForm, TargetQuickForm } from "@/components/crm/team-forms";
import { CrmFrame, Stat, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { isoDay } from "@/server/modules/crm/common";
import { salesTeam } from "@/server/modules/crm/sales";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("sales.tabs.team") };
}

/** Sales team management: members with sales access, capacity, workload, targets and quota attainment. */
export default async function SalesTeamPage() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame area="sales" active="team">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const team = await salesTeam(viewer.ctx, org.id, company.id);
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: team.currency }, locale);
  const pct = (v: number | null) => (v == null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  const sum = (f: (m: (typeof team.members)[number]) => bigint) => team.members.reduce((a, m) => a + f(m), 0n);
  const monthTarget = sum((m) => m.month.targetMinor ?? 0n);
  const monthWon = sum((m) => m.month.wonMinor);
  const bar = (v: number | null) => (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((v ?? 0) * 100)}>
      <div className={(v ?? 0) >= 1 ? "h-full bg-success" : "h-full bg-primary"} style={{ width: `${Math.min(100, (v ?? 0) * 100)}%` }} />
    </div>
  );
  return (
    <CrmFrame area="sales" active="team" subtitle={t("sales.team.subtitle")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("sales.team.members")} value={team.members.length} hint={t("sales.team.unavailable", { count: team.members.filter((m) => !m.available).length })} />
        <Stat label={t("sales.team.monthQuota")} value={money(monthTarget)} hint={formatDate(team.month, locale, "UTC", { month: "long", year: "numeric" })} />
        <Stat label={t("sales.team.monthWon")} value={money(monthWon)} hint={monthTarget > 0n ? pct(Number((monthWon * 10_000n) / monthTarget) / 10_000) : undefined} />
        <Stat label={t("sales.team.openDeals")} value={team.members.reduce((a, m) => a + m.openDeals, 0)} hint={money(sum((m) => m.openDealsMinor))} />
      </div>
      <Card>
        <CardHeader
          title={t("sales.team.title")}
          description={t("sales.team.hint")}
          actions={
            <Link href={`/${locale}/sales/targets`} className="text-xs hover:underline">
              {t("sales.targets.manage")}
            </Link>
          }
        />
        {team.members.length ? (
          <ul className="grid divide-y">
            {team.members.map((m) => (
              <li key={m.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="grid content-start gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {m.name}
                    {!m.available ? <Badge tone="warning">{t("sales.team.away")}</Badge> : null}
                    {m.dealLoad != null && m.dealLoad >= 1 ? <Badge tone="danger">{t("sales.team.atCapacity")}</Badge> : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  {m.role ? <span className="text-xs">{m.role}</span> : null}
                </div>
                <div className="grid content-start gap-2 text-sm">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">{t("sales.team.openDeals")}</dt>
                      <dd className="tabular-nums">
                        <Link href={`/${locale}/crm/deals?owner=${m.id}&status=OPEN`} className="hover:underline">
                          {m.openDeals}
                          {m.maxOpenDeals != null ? ` / ${m.maxOpenDeals}` : ""}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("sales.team.openLeads")}</dt>
                      <dd className="tabular-nums">
                        <Link href={`/${locale}/crm?owner=${m.id}`} className="hover:underline">
                          {m.openLeads}
                          {m.maxOpenLeads != null ? ` / ${m.maxOpenLeads}` : ""}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("sales.team.openTasks")}</dt>
                      <dd className="tabular-nums">{m.openTasks}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("sales.team.followUps")}</dt>
                      <dd className="tabular-nums">{m.openFollowUps}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">{t("sales.team.pipeline", { amount: money(m.openDealsMinor) })}</p>
                  {c.canManage ? (
                    <SalesRepForm
                      base={base}
                      ownerId={m.id}
                      initial={{ maxOpenDeals: m.maxOpenDeals == null ? "" : String(m.maxOpenDeals), maxOpenLeads: m.maxOpenLeads == null ? "" : String(m.maxOpenLeads), available: m.available, role: m.role ?? "" }}
                    />
                  ) : null}
                </div>
                <div className="grid content-start gap-2 text-xs">
                  {(["month", "quarter"] as const).map((k) => (
                    <div key={k} className="grid gap-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-muted-foreground">{t(k === "month" ? "sales.team.thisMonth" : "sales.team.thisQuarter")}</span>
                        <span className="tabular-nums">
                          {money(m[k].wonMinor)} / {m[k].targetMinor != null ? money(m[k].targetMinor!) : t("sales.team.noTarget")} · {pct(m[k].attainment)}
                        </span>
                      </div>
                      {bar(m[k].attainment)}
                    </div>
                  ))}
                  {c.canManage ? <TargetQuickForm base={base} ownerId={m.id} month={isoDay(team.month)!} quarter={isoDay(team.quarter)!} /> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.team.empty")}</p>
        )}
      </Card>
    </CrmFrame>
  );
}
