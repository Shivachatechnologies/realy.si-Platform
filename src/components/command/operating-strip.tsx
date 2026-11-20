import Link from "next/link";
import { ArrowUpRight, ClipboardCheck, Gauge, Sparkles } from "lucide-react";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { DoThisButton } from "@/components/bi/do-this-button";
import { insightCommand, insightText } from "@/components/bi/insight-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { BusinessHealth } from "@/server/modules/bi/health";
import type { liveCommandRuns } from "@/server/modules/guide/command";
import { ApprovalQuick } from "./approval-quick";
import { StageRail } from "./stage-rail";

type Runs = NonNullable<Awaited<ReturnType<typeof liveCommandRuns>>>;
interface PendingApproval {
  id: string;
  summary: string;
  risk: string;
  expiresAt: Date;
  taskId: string | null;
}

const healthTone = (s: number | null) => (s === null ? "text-muted-foreground" : s >= 65 ? "text-success" : s >= 45 ? "text-warning" : "text-danger");

/**
 * The operating layer of the Command Center: AI commands in flight (stages from real rows), proposals waiting for a
 * person's decision, and the explainable business-health score with its most important insight. Every panel shows
 * its own empty / forbidden state.
 */
export function OperatingStrip({
  t,
  locale,
  base,
  runs,
  approvals,
  canDecide,
  health,
  runBlocked,
}: {
  t: Translate;
  locale: string;
  base: string;
  runs: Runs | null;
  approvals: PendingApproval[] | null;
  canDecide: boolean;
  health: BusinessHealth | null;
  runBlocked: string | null;
}) {
  const top = health?.insights[0] ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* AI commands in flight */}
      <section className="panel-float grid content-start gap-3 rounded-3xl border bg-surface/70 p-4 backdrop-blur sm:p-5" aria-labelledby="cc-runs">
        <header className="flex items-center justify-between gap-2">
          <h2 id="cc-runs" className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-4 text-world" aria-hidden />
            {t("command.ops.runsTitle")}
          </h2>
          <Link href={`/${locale}/command`} className="inline-flex min-h-9 items-center gap-1 text-xs text-primary hover:underline">
            {t("command.ops.openCommand")}
            <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        </header>
        {runs === null ? (
          <p className="text-sm text-muted-foreground">{t("command.ops.runsForbidden")}</p>
        ) : runs.length === 0 ? (
          <div className="grid justify-items-start gap-2">
            <p className="text-sm text-muted-foreground">{t("command.ops.runsEmpty")}</p>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/command?q=${encodeURIComponent(t("guide.command.suggest.customers"))}`}>{t("guide.command.suggest.customers")}</Link>
            </Button>
          </div>
        ) : (
          <ul className="grid gap-3">
            {runs.map((r) => {
              const body = (
                <>
                  <span className="flex items-center gap-2">
                    <span className="flex -space-x-1.5 rtl:space-x-reverse" aria-hidden>
                      {r.profiles.slice(0, 4).map((p) => (
                        <AiAvatar key={p} seed={p} department={p} size={20} active={r.status === "RUNNING" || r.status === "REVIEWING"} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.text ?? t("command.ops.teammateRun")}</span>
                    {r.pendingApprovals ? <Badge tone="warning">{r.pendingApprovals}</Badge> : null}
                  </span>
                  <StageRail stages={r.stages} compact />
                  <span className="text-[11px] text-muted-foreground">
                    {t(`command.ai.runStatus.${r.status}`)} · {formatRelativeTime(r.updatedAt, locale)}
                  </span>
                </>
              );
              return (
                <li key={r.id}>
                  {r.sessionId ? (
                    <Link href={`/${locale}/command?s=${r.sessionId}`} className="grid gap-2 rounded-xl border bg-surface/80 p-3 hover:border-primary/40">
                      {body}
                    </Link>
                  ) : (
                    <div className="grid gap-2 rounded-xl border bg-surface/80 p-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Waiting for you */}
      <section className="panel-float grid content-start gap-3 rounded-3xl border bg-surface/70 p-4 backdrop-blur sm:p-5" aria-labelledby="cc-approvals">
        <header className="flex items-center justify-between gap-2">
          <h2 id="cc-approvals" className="flex items-center gap-2 font-display text-xl">
            <ClipboardCheck className="size-4 text-world" aria-hidden />
            {t("command.ops.approvalsTitle")}
            {approvals?.length ? <Badge tone="warning">{approvals.length}</Badge> : null}
          </h2>
          <Link href={`/${locale}/approvals`} className="inline-flex min-h-9 items-center gap-1 text-xs text-primary hover:underline">
            {t("command.ops.allApprovals")}
            <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        </header>
        {approvals === null ? (
          <p className="text-sm text-muted-foreground">{t("command.ops.approvalsForbidden")}</p>
        ) : approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("command.ops.approvalsEmpty")}</p>
        ) : (
          <ul className="grid gap-2">
            {approvals.map((a) => (
              <li key={a.id} className="grid gap-2 rounded-xl border bg-surface/80 p-3">
                <span className="flex items-start gap-2 text-sm">
                  <Badge tone={a.risk === "HIGH" ? "danger" : a.risk === "MEDIUM" ? "warning" : "neutral"}>{t(`command.ops.risk.${a.risk}`)}</Badge>
                  <span className="min-w-0 flex-1">{a.summary}</span>
                </span>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">{t("command.ops.expires", { when: formatRelativeTime(a.expiresAt, locale) })}</span>
                  {canDecide ? <ApprovalQuick base={base} approvalId={a.id} summary={a.summary} /> : a.taskId ? (
                    <Link href={`/${locale}/tasks/${a.taskId}`} className="text-xs text-primary hover:underline">
                      {t("guide.task.open")}
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Business health */}
      <section className="panel-float grid content-start gap-3 rounded-3xl border bg-surface/70 p-4 backdrop-blur sm:p-5" aria-labelledby="cc-health">
        <header className="flex items-center justify-between gap-2">
          <h2 id="cc-health" className="flex items-center gap-2 font-display text-xl">
            <Gauge className="size-4 text-world" aria-hidden />
            {t("command.ops.healthTitle")}
          </h2>
          <Link href={`/${locale}/analytics/health`} className="inline-flex min-h-9 items-center gap-1 text-xs text-primary hover:underline">
            {t("command.ops.openHealth")}
            <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        </header>
        {health === null ? (
          <p className="text-sm text-muted-foreground">{t("command.kpisForbidden")}</p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className={`numeral font-display text-6xl leading-none ${healthTone(health.score)}`}>{health.score ?? "—"}</span>
              <span className="pb-1 text-xs text-muted-foreground">{health.score === null ? t("command.ops.healthNotEnough") : t("command.ops.healthOutOf", { metrics: health.scoredMetrics })}</span>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {health.departments
                .filter((d) => d.score !== null)
                .slice(0, 6)
                .map((d) => (
                  <li key={d.department}>
                    <Link href={`/${locale}/analytics/departments/${d.department}`} className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs hover:border-primary/40 ${healthTone(d.score)}`}>
                      <span className="text-foreground">{t(`analytics.departments.${d.department}`)}</span> {d.score}
                    </Link>
                  </li>
                ))}
            </ul>
            {top ? (
              <div className="grid gap-2 rounded-xl border bg-surface/80 p-3">
                <p className="text-sm">{insightText(t, top)}</p>
                <DoThisButton base={base} command={insightCommand(t, top)} disabledReason={runBlocked} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("analytics.health.noInsights")}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
