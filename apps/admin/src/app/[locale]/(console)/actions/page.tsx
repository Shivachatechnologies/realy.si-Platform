import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleDashed, Inbox, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, EmptyState, QuickFilters, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { AutoRefresh } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { actionCenter, type ActionDomain } from "@/server/modules/admin/action-center";
import { requestTime, requireViewer } from "@/server/session";

const DOMAINS: ActionDomain[] = ["ops", "billing", "security", "ai", "integrations", "content"];

/**
 * Action Center (stream A): everything on the platform that needs an administrator, most severe first. Each item is
 * a real count with the oldest affected row, a sample, an investigate link and the next step. Items appear only for
 * admins who may open their link. Sources that need tables other streams have not shipped are listed as not tracked.
 */
export default async function ActionCenterPage({ searchParams }: PageProps<"/[locale]/actions">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const domainParam = sp((await searchParams).domain);
  const domain = DOMAINS.find((d) => d === domainParam);
  const q = await actionCenter(viewer.ctx);
  const base = `/${locale}`;
  const items = domain ? q.items.filter((i) => i.domain === domain) : q.items;
  const pending = domain ? q.pending.filter((p) => p.domain === domain) : q.pending;
  const counts = Object.fromEntries(DOMAINS.map((d) => [d, q.items.filter((i) => i.domain === d).length]));

  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Inbox />}
        title={t("admin.actions.title")}
        description={t("admin.actions.subtitle")}
        why={t("admin.actions.why")}
        actions={<AutoRefresh seconds={60} loadedAt={requestTime()} timeZone={viewer.user.timezone} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />}
        meta={
          <span className="text-xs text-muted-foreground">
            {t("admin.shell.updated")} <Timestamp value={new Date(q.computedAt)} mode="relative" /> · {t("admin.actions.cacheNote")}
          </span>
        }
      />
      <Card>
        <QuickFilters
          base={`${base}/actions`}
          name="domain"
          value={domain}
          params={{}}
          label={t("admin.actions.filterLabel")}
          options={[{ value: "", label: t("admin.common.all"), count: q.items.length }, ...DOMAINS.map((d) => ({ value: d, label: t(`admin.actions.domains.${d}`), count: counts[d] }))]}
        />
        {items.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title={t("admin.actions.allClear")} body={t("admin.actions.allClearHint")} />
        ) : (
          <ol className="divide-y">
            {items.map((i) => (
              <li key={i.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge domain="actionSeverity" value={i.severity} pulse={i.severity === "critical"}>
                      {t(`admin.actions.severity.${i.severity}`)}
                    </StatusBadge>
                    <Badge>{t(`admin.actions.domains.${i.domain}`)}</Badge>
                    <h2 className="text-sm font-semibold">{t(`admin.actions.kinds.${i.id}.title`, { count: i.count })}</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t("admin.actions.nextStep")}</span> {t(`admin.actions.kinds.${i.id}.next`)}
                    {i.oldestAt ? (
                      <>
                        {" · "}
                        {t("admin.actions.waitingSince")} <Timestamp value={i.oldestAt} mode="relative" />
                      </>
                    ) : null}
                  </p>
                  {i.samples.length ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {i.samples.map((s) => {
                        const body = (
                          <>
                            <span className="max-w-48 truncate font-medium">{s.label}</span>
                            {s.sub ? <span className="text-muted-foreground">{s.sub}</span> : null}
                            {s.at ? <Timestamp value={s.at} mode="relative" className="text-muted-foreground" /> : null}
                          </>
                        );
                        return (
                          <li key={s.id}>
                            {s.href ? (
                              <Link href={`${base}${s.href}`} className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-0.5 text-[11px] hover:border-border-strong focus-visible:outline-2">
                                {body}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-0.5 text-[11px]">{body}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
                <Link href={`${base}${i.href}`} className="inline-flex h-8 items-center gap-1 justify-self-start rounded-md border bg-surface px-3 text-xs font-medium hover:border-border-strong focus-visible:outline-2 sm:justify-self-end">
                  {t("admin.actions.investigate")}
                  <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        )}
        {q.failed.length ? (
          <p role="status" className="flex items-center gap-2 border-t px-4 py-2 text-xs text-warning">
            <TriangleAlert className="size-3.5" aria-hidden />
            {t("admin.actions.someUnavailable", { count: q.failed.length })} <span className="font-mono">{q.failed.join(", ")}</span>
          </p>
        ) : null}
      </Card>
      {pending.length ? (
        <Card>
          <CardHeader icon={<CircleDashed />} title={t("admin.actions.notTrackedTitle")} description={t("admin.actions.notTrackedHint")} />
          <ul className="divide-y">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{t(`admin.actions.pending.${p.id}`)}</span>
                <span className="text-xs text-muted-foreground">{t("admin.overview.cc.needs", { needs: p.needs, stream: p.stream })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
