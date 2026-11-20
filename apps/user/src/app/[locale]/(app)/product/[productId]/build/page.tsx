import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { productWorkspace } from "@/components/work/product-ui";
import { LifecycleRail } from "@/components/work/product-studio";
import { BuildFlow } from "@/components/product-studio/build-flow";
import { getT } from "@/i18n/server";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { productFlow } from "@/server/modules/work/product-flow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("productStudio.flow.title") };
}

/** "Build a product with AI": one guided flow from idea to launch, every stage producing saved deliverables. */
export default async function ProductBuildPage({ params }: PageProps<"/[locale]/product/[productId]/build">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "overview");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, canEdit } = w;
  const flow = await productFlow(viewer.ctx, org.id, company.id, productId);
  const ai = aiConfigured();
  const canAi = canEdit && w.canRunAgents && ai;
  const percent = Math.round((flow.done / flow.total) * 100);
  const backlogAi = flow.backlog.ai?.status === "QUEUED" || flow.backlog.ai?.status === "RUNNING";
  const running = backlogAi || flow.steps.some((s) => s.docs.some((d) => d.state === "drafting"));
  return (
    <div className="mx-auto grid max-w-[1000px] min-w-0 gap-4">
      {w.header}
      <AutoRefresh active={running} intervalMs={8000} />
      <Card variant="glass" className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="grid gap-0.5">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">{t("productStudio.flow.eyebrow")}</p>
            <h2 className="font-display text-2xl text-balance">{t("productStudio.flow.title")}</h2>
            <p className="text-sm text-pretty text-muted-foreground">{t("productStudio.flow.lead")}</p>
          </div>
          <span className="font-display text-3xl tabular-nums">
            {flow.done}/{flow.total}
          </span>
        </div>
        <AnimatedProgress value={percent} label={t("productStudio.flow.progress", { done: flow.done, total: flow.total })} active={running} />
        <LifecycleRail t={t} stage={flow.product.stage} />
      </Card>
      {!ai ? <Notice tone="info">{t("productStudio.flow.noAi")}</Notice> : !w.canRunAgents ? <Notice tone="info">{t("productStudio.flow.noAgents")}</Notice> : null}
      {!canEdit ? <Notice tone="warning">{t("productStudio.flow.readOnly")}</Notice> : null}
      <BuildFlow t={t} locale={locale} base={base} flow={flow} canEdit={canEdit} canAi={canAi} />
    </div>
  );
}
