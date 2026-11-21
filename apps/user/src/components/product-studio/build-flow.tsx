import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Circle, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionButton, AiButton } from "@/components/work/actions";
import { CreateAndOpen } from "@/components/work/product-client";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import type { FlowDocState, ProductFlow } from "@/server/modules/work/product-flow";

const DOC_TONE: Record<FlowDocState, "neutral" | "warning" | "accent" | "info" | "success"> = { missing: "neutral", drafting: "warning", draft_ready: "accent", saved: "info", in_review: "info", approved: "success" };

/**
 * "Build a product with AI": the guided flow as one vertical journey. Each stage shows its saved deliverables with their
 * real state and exactly the next action (draft with AI → save the draft → open/approve; create the project → generate
 * the backlog → start the sprint → write release notes → hand the launch brief to Marketing). The current stage is
 * highlighted with "Help me do this".
 */
export function BuildFlow({ t, locale, base, flow, canEdit, canAi }: { t: Translate; locale: string; base: string; flow: ProductFlow; canEdit: boolean; canAi: boolean }) {
  const id = flow.product.id;
  const api = `${base}/product/products/${id}`;
  const ws = `/${locale}/product/${id}`;
  const taskLink = (taskId: string) => (
    <Link href={`/${locale}/tasks/${taskId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
      {t("productStudio.flow.aiWorking")}
    </Link>
  );

  const docRow = (d: ProductFlow["steps"][number]["docs"][number]) => (
    <li key={d.kind} className="flex flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(`product.docKinds.${d.kind}`)}</span>
      <Badge tone={DOC_TONE[d.state]} pulse={d.state === "drafting"}>
        {t(`productStudio.flow.docState.${d.state}`)}
        {d.version ? ` · v${d.version}` : ""}
      </Badge>
      {d.state === "drafting" && d.task ? taskLink(d.task.id) : null}
      {d.state === "draft_ready" && d.task && canEdit ? (
        <ActionButton url={`${api}/docs/${d.kind}/draft`} body={{ taskId: d.task.id }} variant="default">
          {t("productStudio.flow.saveDraft")}
        </ActionButton>
      ) : null}
      {(d.state === "missing" || d.state === "saved" || d.state === "in_review") && canAi ? <AiButton url={`${api}/docs/${d.kind}/ai`} label={d.state === "missing" ? t("productStudio.flow.draftAi") : t("productStudio.flow.improveAi")} /> : null}
      {d.version ? (
        <Link href={`${ws}/documents/${d.kind.toLowerCase()}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          {d.state === "approved" ? t("productStudio.flow.open") : t("productStudio.flow.reviewApprove")}
          <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}
    </li>
  );

  const extra = (key: ProductFlow["steps"][number]["key"]) => {
    if (key === "backlog") {
      if (!flow.backlog.projectId)
        return canEdit ? (
          <ActionButton url={`${api}/project`} variant="default">
            {t("product.createProject")}
          </ActionButton>
        ) : null;
      const running = flow.backlog.ai && (flow.backlog.ai.status === "QUEUED" || flow.backlog.ai.status === "RUNNING");
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t("productStudio.flow.backlogCount", { count: flow.backlog.tasks, done: flow.backlog.done })}</span>
          {running && flow.backlog.ai ? taskLink(flow.backlog.ai.id) : canAi && canEdit ? <AiButton url={`${api}/plan/apply`} label={t("productStudio.flow.backlogAi")} /> : null}
          <Link href={`${ws}/backlog`} className="text-xs text-primary hover:underline">
            {t("productStudio.flow.openBacklog")}
          </Link>
        </div>
      );
    }
    if (key === "sprint") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {flow.sprint ? (
            <span className="text-sm">
              {t("productStudio.flow.sprintInfo", { name: flow.sprint.name, count: flow.sprint.tasks })} <Badge tone={flow.sprint.status === "ACTIVE" ? "info" : "neutral"}>{t(`productStudio.flow.sprintStatus.${flow.sprint.status}`)}</Badge>
            </span>
          ) : null}
          {canEdit && flow.backlog.tasks > 0 ? (
            <ActionButton url={`${api}/flow/sprint`} variant={flow.sprint ? "secondary" : "default"}>
              {flow.sprint ? t("productStudio.flow.sprintAdd") : t("productStudio.flow.sprintStart")}
            </ActionButton>
          ) : null}
          {flow.backlog.projectId ? (
            <Link href={`/${locale}/projects/${flow.backlog.projectId}`} className="text-xs text-primary hover:underline">
              {t("productStudio.flow.openProject")}
            </Link>
          ) : null}
        </div>
      );
    }
    if (key === "release") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {flow.release ? <span className="text-sm">{t(flow.release.hasNotes ? "productStudio.flow.releaseInfo" : "productStudio.flow.releaseNoNotes", { version: flow.release.version })}</span> : null}
          {canEdit && flow.backlog.projectId ? (
            <ActionButton url={`${api}/flow/release-notes`} variant={flow.release?.hasNotes ? "secondary" : "default"}>
              {flow.release?.hasNotes ? t("productStudio.flow.releaseRefresh") : t("productStudio.flow.releaseWrite")}
            </ActionButton>
          ) : null}
          <Link href={`${ws}/releases`} className="text-xs text-primary hover:underline">
            {t("productStudio.flow.openReleases")}
          </Link>
        </div>
      );
    }
    if (key === "launch") {
      return flow.campaign ? (
        <Link href={`/${locale}/marketing/campaigns/${flow.campaign.id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          {t("productStudio.flow.campaignLinked", { name: flow.campaign.name })}
          <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : canEdit && flow.canMarketing ? (
        <CreateAndOpen url={`${api}/campaign`} hrefPrefix={`/${locale}/marketing/campaigns/`} label={t("productStudio.flow.handToMarketing")} />
      ) : (
        <p className="text-xs text-muted-foreground">{t("productStudio.flow.marketingNeeded")}</p>
      );
    }
    return null;
  };

  return (
    <ol className="relative grid gap-3">
      <span aria-hidden className="absolute start-[1.15rem] top-4 bottom-4 w-px bg-gradient-to-b from-primary/60 via-border to-border" />
      {flow.steps.map((s, i) => {
        const current = s.position === "current";
        return (
          <li key={s.key} className="relative grid grid-cols-[2.3rem_minmax(0,1fr)] gap-3" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "relative z-10 grid size-9 place-items-center rounded-full border bg-surface text-sm font-semibold tabular-nums",
                s.done && "border-success/50 bg-success/10 text-success",
                current && "border-primary bg-primary text-primary-foreground shadow-glow",
              )}
            >
              {s.done ? <CheckCircle2 className="size-4" aria-hidden /> : current ? i + 1 : <Circle className="size-3.5 text-muted-foreground" aria-hidden />}
            </span>
            <section className={cn("grid gap-3 rounded-2xl border bg-surface/70 p-4 backdrop-blur", current && "border-primary/40 shadow-elev-2", !current && !s.done && "opacity-80")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid min-w-0 gap-0.5">
                  <h3 className="font-display text-base">{t(`productStudio.flow.steps.${s.key}.title`)}</h3>
                  <p className="text-xs text-pretty text-muted-foreground">{t(`productStudio.flow.steps.${s.key}.what`)}</p>
                </div>
                <span className="flex flex-wrap items-center gap-1">
                  {s.inStage ? <Badge tone="accent">{t("productStudio.flow.lifecycleHere")}</Badge> : null}
                  <Badge tone={s.done ? "success" : current ? "info" : "neutral"}>{t(`productStudio.flow.position.${s.position}`)}</Badge>
                </span>
              </div>
              {current ? (
                <p className="flex items-start gap-2 rounded-xl bg-primary/8 px-3 py-2 text-xs text-pretty">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                  <span>
                    <strong className="font-semibold">{t("productStudio.flow.helpMe")}</strong> {t(`productStudio.flow.steps.${s.key}.help`)}
                  </span>
                </p>
              ) : null}
              {s.docs.length ? <ul className="grid gap-1.5">{s.docs.map(docRow)}</ul> : null}
              {extra(s.key)}
            </section>
          </li>
        );
      })}
    </ol>
  );
}
