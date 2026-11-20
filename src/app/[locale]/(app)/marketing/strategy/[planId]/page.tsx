import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, CheckCircle2, Megaphone, Play, Send, Sparkles, Wand2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { MarketingShell, Meter, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { AiRequest } from "@/components/marketing/ai-panel";
import { ActionButton } from "@/components/marketing/ui";
import { PlanEditor } from "@/components/marketing/plan-editor";
import { RequestPlanChanges } from "@/components/marketing/plan-actions";
import { BudgetDonut } from "@/components/marketing/plan-visuals";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { listGoals } from "@/server/modules/marketing/intelligence";
import { getPlan, ingestPlanTask, parseAiDraft, PLAN_SUBJECT, planChannels, planObjectives } from "@/server/modules/marketing/plans";
import { usableResearch } from "@/server/modules/marketing/research-reports";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.strategy.detailTitle") };
}

export default async function MarketingPlanPage({ params }: PageProps<"/[locale]/marketing/strategy/[planId]">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/strategy`, label: t("marketing.strategy.title") };
  const shell = { locale, t, tab: "strategy" as const, title: t("marketing.strategy.detailTitle"), back };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady, canManage, canRunAgents } = m;
  const { planId } = await params;
  let p;
  try {
    p = await getPlan(viewer.ctx, org.id, company.id, planId);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  if (p.draftTaskId && !p.aiDraft && !p.draftError) {
    await ingestPlanTask(p.id, company.id, p.draftTaskId);
    p = await getPlan(viewer.ctx, org.id, company.id, planId);
  }
  const [tasks, research, goals] = await Promise.all([
    listSubjectTasks(viewer.ctx, org.id, company.id, PLAN_SUBJECT, p.id, 5).catch(() => []),
    usableResearch(org.id, company.id, undefined, 30),
    p.goalIds.length ? listGoals(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const path = `${base}/plans/${p.id}`;
  const act = `${path}/actions`;
  const objectives = planObjectives(p.objectives);
  const channels = planChannels(p.channels);
  const draft = parseAiDraft(p.aiDraft);
  const planGoals = goals.filter((g) => p.goalIds.includes(g.id));
  const linked = research.filter((r) => p.researchIds.includes(r.id));
  const running = tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING");
  const editable = canManage && p.status === "DRAFT";
  const money = (v: bigint | number) => formatMoney({ amountMinor: BigInt(Math.round(Number(v))), currency: p.currency }, locale);

  return (
    <MarketingShell
      {...shell}
      title={p.name}
      subtitle={`${formatDate(p.periodStart, locale, "UTC")} – ${formatDate(p.periodEnd, locale, "UTC")} · ${money(p.budgetMinor)}`}
      actions={
        canManage ? (
          <div className="flex flex-wrap items-start gap-2">
            {p.status === "DRAFT" ? <ActionButton path={act} body={{ action: "submit" }} variant="default" label={t("marketing.strategy.actions.submit")} icon={<Send aria-hidden />} /> : null}
            {p.status === "IN_REVIEW" ? <ActionButton path={act} body={{ action: "approve" }} variant="default" label={t("marketing.strategy.actions.approve")} icon={<CheckCircle2 aria-hidden />} /> : null}
            {p.status === "IN_REVIEW" ? <RequestPlanChanges path={act} /> : null}
            {(p.status === "APPROVED" || p.status === "ACTIVE") && !p.campaignId ? <ActionButton path={act} body={{ action: "create_campaign" }} variant="default" label={t("marketing.strategy.actions.createCampaign")} icon={<Megaphone aria-hidden />} /> : null}
            {p.status === "APPROVED" ? <ActionButton path={act} body={{ action: "activate" }} label={t("marketing.strategy.actions.activate")} icon={<Play aria-hidden />} /> : null}
            {p.status !== "ARCHIVED" ? <ActionButton path={act} body={{ action: "archive" }} variant="ghost" label={t("marketing.common.archive")} icon={<Archive aria-hidden />} confirm={t("marketing.common.confirmArchive")} /> : null}
          </div>
        ) : null
      }
    >
      <AutoRefresh active={running} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={p.status} label={t(`marketing.strategy.status.${p.status}`)} />
        <span>{t(`marketing.strategy.statusHint.${p.status}`)}</span>
        {p.approvedAt ? <span>· {t("marketing.strategy.approvedAt", { date: formatDateTime(p.approvedAt, locale, tz) })}</span> : null}
        {p.campaignId ? (
          <Link href={`/${locale}/marketing/campaigns/${p.campaignId}`} className="font-medium text-primary hover:underline">
            · {t("marketing.strategy.openCampaign")}
          </Link>
        ) : null}
      </div>
      {p.reviewNote && p.status === "DRAFT" ? <Notice tone="warning">{t("marketing.strategy.changesRequested", { note: p.reviewNote })}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {editable ? (
            <Card className="p-4 sm:p-5">
              <PlanEditor
                base={base}
                locale={locale}
                currency={p.currency}
                research={research.map((r) => ({ id: r.id, title: r.title, kind: r.kind }))}
                initial={{
                  id: p.id,
                  name: p.name,
                  periodStart: p.periodStart.toISOString().slice(0, 10),
                  periodEnd: p.periodEnd.toISOString().slice(0, 10),
                  budget: p.budgetMinor > 0n ? (Number(p.budgetMinor) / 100).toFixed(2) : "",
                  positioning: p.positioning ?? "",
                  audience: p.audience ?? "",
                  messaging: p.messaging ?? "",
                  objectives: objectives.map((o) => ({ metric: o.metric, target: o.target, label: o.label ?? "" })),
                  channels: channels.map((c) => ({ channel: c.channel, role: c.role, budget: Number(c.budgetMinor) > 0 ? (Number(c.budgetMinor) / 100).toFixed(2) : "", cadence: c.cadence, rationale: c.rationale })),
                  researchIds: p.researchIds,
                }}
              />
            </Card>
          ) : (
            <>
              <Card className="grid gap-4 p-5 md:grid-cols-3">
                {(["positioning", "audience", "messaging"] as const).map((k) => (
                  <div key={k}>
                    <p className="eyebrow-rule mb-2">{t(`marketing.strategy.form.${k}`)}</p>
                    <p className="whitespace-pre-wrap text-sm">{p[k] || "—"}</p>
                  </div>
                ))}
              </Card>
              <Card>
                <CardHeader title={t("marketing.strategy.form.objectives")} description={planGoals.length ? t("marketing.strategy.goalsHint") : undefined} />
                {objectives.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t("marketing.strategy.noObjectives")}</p>
                ) : (
                  <ul className="grid gap-3 p-4 sm:grid-cols-2">
                    {objectives.map((o, i) => {
                      // Goals were created in objective order on approval.
                      const g = planGoals.find((x) => x.id === p.goalIds[i]);
                      return (
                        <li key={i} className="grid gap-1.5 rounded-lg border bg-surface p-3">
                          <span className="text-xs text-muted-foreground">{t(`marketing.studio.goals.metric.${o.metric}`)}</span>
                          <span className="font-medium">{o.label || t(`marketing.studio.goals.metric.${o.metric}`)}</span>
                          <span className="font-display text-display tabular-nums">
                            {g ? `${formatNumber(Math.round(g.current), locale)} / ` : ""}
                            {formatNumber(o.target, locale)}
                          </span>
                          {g ? <Meter value={g.progress} label={o.label || o.metric} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              {channels.length ? (
                <Card>
                  <CardHeader title={t("marketing.strategy.form.channels")} />
                  <ul className="grid divide-y">
                    {channels.map((c) => (
                      <li key={c.channel} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4">
                        <span className="font-medium">
                          {t(`marketing.channels.${c.channel}`)}
                          <span className="block text-xs font-normal text-muted-foreground">{t(`marketing.strategy.role.${c.role}`)}</span>
                        </span>
                        <span className="text-muted-foreground">
                          {c.cadence ? <span className="block text-foreground">{c.cadence}</span> : null}
                          {c.rationale}
                        </span>
                        <span className="tabular-nums">{money(Number(c.budgetMinor))}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">{t("marketing.strategy.budgetSplit")}</p>
            <BudgetDonut channels={channels} totalMinor={p.budgetMinor} currency={p.currency} locale={locale} t={t} />
          </Card>

          <Card className="grid gap-3 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" aria-hidden />
              {t("marketing.strategy.ai.title")}
            </p>
            <p className="text-xs text-muted-foreground">{t("marketing.strategy.ai.hint")}</p>
            {editable && canRunAgents ? <AiRequest path={`${path}/ai`} kind="draft" label={t("marketing.strategy.ai.draft")} notePlaceholder={t("marketing.strategy.ai.note")} /> : null}
            {editable && !canRunAgents ? <p className="text-xs text-muted-foreground">{t("marketing.strategy.ai.noPermission")}</p> : null}
            {p.draftError ? <Notice tone="danger">{t("marketing.strategy.ai.failed", { error: p.draftError })}</Notice> : null}
            {draft ? (
              <div className="grid gap-2 rounded-lg border bg-surface p-3 text-sm">
                <p className="text-[11px] font-semibold tracking-wide text-primary uppercase">{t("marketing.strategy.ai.proposal")}</p>
                {draft.positioning ? <p>{draft.positioning}</p> : null}
                {draft.objectives.length ? (
                  <ul className="list-disc ps-4 text-xs">
                    {draft.objectives.map((o, i) => (
                      <li key={i}>
                        {t(`marketing.studio.goals.metric.${o.metric}`)}: {formatNumber(o.target, locale)} {o.label ? `— ${o.label}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft.channels.length ? (
                  <ul className="grid gap-1 text-xs">
                    {draft.channels.map((c) => (
                      <li key={c.channel} className="flex justify-between gap-2">
                        <span>
                          {t(`marketing.channels.${c.channel}`)} · {t(`marketing.strategy.role.${c.role}`)}
                        </span>
                        <span className="tabular-nums">{Math.round(c.budgetShare * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft.assumptions.length ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">{t("marketing.strategy.ai.assumptions", { count: draft.assumptions.length })}</summary>
                    <ul className="mt-1 list-disc ps-4">{draft.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </details>
                ) : null}
                {editable ? <ActionButton path={act} body={{ action: "apply_ai_draft" }} variant="default" label={t("marketing.strategy.ai.apply")} icon={<Wand2 aria-hidden />} confirm={t("marketing.strategy.ai.applyConfirm")} /> : null}
              </div>
            ) : null}
            <AiTaskList tasks={tasks} locale={locale} tz={tz} t={t} aiReady={aiReady} showOutput={false} />
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">{t("marketing.strategy.form.research")}</p>
            {linked.length ? (
              <ul className="grid gap-1.5 text-sm">
                {linked.map((r) => (
                  <li key={r.id}>
                    <Link href={`/${locale}/marketing/intelligence/${r.id}`} className="hover:underline">
                      <span className="me-2 text-[11px] text-muted-foreground">{t(`marketing.intelligence.kind.${r.kind}`)}</span>
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("marketing.strategy.noResearch")}{" "}
                <Link href={`/${locale}/marketing/intelligence`} className="text-primary hover:underline">
                  {t("marketing.tabs.intelligence")}
                </Link>
              </p>
            )}
          </Card>
        </div>
      </div>
    </MarketingShell>
  );
}
