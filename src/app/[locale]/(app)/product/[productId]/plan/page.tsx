import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { PlanStarter } from "@/components/work/product-client";
import { PLAN_TONE, productWorkspace } from "@/components/work/product-ui";
import { TASK_TONE } from "@/components/work/ui";
import { formatDateTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { listPlans, PLAN_STEPS } from "@/server/modules/work/product-plan";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.workspace.tabs.plan") };
}

export default async function PlanPage({ params }: PageProps<"/[locale]/product/[productId]/plan">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "plan");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, tz, canEdit, canRunAgents } = w;
  const [runs, applyTasks] = await Promise.all([listPlans(viewer.ctx, org.id, company.id, productId), canRunAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "product", productId) : []]);
  const running = runs.some((r) => r.status === "RUNNING");
  const configured = aiConfigured();
  const docs = `/${locale}/product/${productId}/documents`;
  return (
    <div className="mx-auto grid max-w-[1200px] min-w-0 gap-4">
      {w.header}
      <Card>
        <CardHeader title={t("product.plan.title")} description={t("product.plan.hint")} />
        <CardBody className="grid gap-3">
          <ol className="flex flex-wrap gap-1 text-xs">
            {PLAN_STEPS.map((s, i) => (
              <li key={s.key} className="rounded-md border px-2 py-1">
                {i + 1}. {t(`profiles.${s.profile}.name`)} → {t(`product.docKinds.${s.docKind}`)}
              </li>
            ))}
          </ol>
          {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
          {canEdit && canRunAgents && configured ? (
            running ? (
              <p className="text-sm text-muted-foreground">{t("product.plan.running")}</p>
            ) : (
              <PlanStarter base={base} productId={productId} />
            )
          ) : null}
        </CardBody>
      </Card>
      {runs.map((r) => (
        <Card key={r.id}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t("product.plan.run", { date: formatDateTime(r.createdAt, locale, tz) })}
                <Badge tone={PLAN_TONE[r.status]}>{t(`product.planStatus.${r.status}`)}</Badge>
              </span>
            }
            description={r.brief ?? undefined}
            actions={
              canEdit ? (
                <span className="flex gap-1">
                  {r.status === "RUNNING" ? (
                    <ActionButton url={`${base}/product/plans/${r.id}/cancel`} variant="ghost" confirm={t("product.plan.confirmCancel")}>
                      {t("common.cancel")}
                    </ActionButton>
                  ) : null}
                  {r.status === "FAILED" && canRunAgents ? <ActionButton url={`${base}/product/plans/${r.id}/retry`}>{t("product.plan.retry")}</ActionButton> : null}
                </span>
              ) : null
            }
          />
          <CardBody className="grid gap-2">
            {r.error ? <Notice tone="danger">{r.error}</Notice> : null}
            <ol className="grid gap-1 text-sm">
              {r.steps.map((s, i) => (
                <li key={s.key} className="flex flex-wrap items-center gap-2">
                  <span className="w-5 text-end text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    {t(`profiles.${s.profile}.name`)} · {t(`product.docKinds.${s.docKind}`)}
                  </span>
                  {s.task ? (
                    <Link href={`/${locale}/tasks/${s.task.id}`} className="hover:underline">
                      <Badge tone={TASK_TONE[s.task.status]}>{t(`agentTasks.status.${s.task.status}`)}</Badge>
                    </Link>
                  ) : (
                    <Badge>{t(`product.stepStatus.${s.status}`)}</Badge>
                  )}
                  {s.status === "DONE" ? (
                    <Link href={`${docs}/${s.docKind.toLowerCase()}${s.docVersion ? `?version=${s.docVersion}` : ""}`} className="text-xs text-primary hover:underline">
                      {s.docVersion ? t("product.plan.openDocVersion", { version: s.docVersion }) : t("product.plan.openDoc")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ))}
      <AiPanel
        t={t}
        locale={locale}
        tz={tz}
        title={t("product.plan.applyTitle")}
        description={t("product.plan.applyHint")}
        configured={configured}
        tasks={applyTasks}
        actions={canRunAgents && canEdit ? <AiButton url={`${base}/product/products/${productId}/plan/apply`} label={t("product.plan.apply")} /> : null}
      />
    </div>
  );
}
