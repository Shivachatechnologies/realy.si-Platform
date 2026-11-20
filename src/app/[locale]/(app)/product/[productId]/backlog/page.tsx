import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { BacklogForm, PushToSprint } from "@/components/work/product-client";
import { productWorkspace } from "@/components/work/product-ui";
import { Empty, ITEM_TONE, STATUS_TONE } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { getBacklog } from "@/server/modules/work/product-delivery";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.workspace.tabs.backlog") };
}

export default async function BacklogPage({ params }: PageProps<"/[locale]/product/[productId]/backlog">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "backlog");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, tz, canEdit, canRunAgents } = w;
  const [b, aiTasks] = await Promise.all([getBacklog(viewer.ctx, org.id, company.id, productId), canRunAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "product", productId) : []]);
  const sprints = b.sprints.map((s) => ({ id: s.id, name: `${s.name} · ${t(`work.sprintStatus.${s.status}`)}` }));
  const sprintName = new Map(b.sprints.map((s) => [s.id, s.name]));
  const task = (x: { id: string; title: string; status: keyof typeof STATUS_TONE; estimatePoints: number | null; sprintId: string | null; assignee: { name: string } | null }) => (
    <li key={x.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
      <Badge tone={STATUS_TONE[x.status]}>{t(`work.taskStatus.${x.status}`)}</Badge>
      <Link href={`/${locale}/projects/tasks/${x.id}`} className="min-w-0 flex-1 truncate hover:underline">
        {x.title}
      </Link>
      {x.estimatePoints != null ? <span className="text-xs text-muted-foreground">{t("product.backlog.pts", { count: x.estimatePoints })}</span> : null}
      {x.sprintId ? <Badge tone="accent">{sprintName.get(x.sprintId) ?? t("product.backlog.inSprint")}</Badge> : null}
      <span className="text-xs text-muted-foreground">{x.assignee?.name ?? ""}</span>
    </li>
  );
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      {!b.projectId ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center gap-2">
            {t("product.backlog.noProject")}
            {canEdit ? (
              <ActionButton url={`${base}/product/products/${productId}/project`}>{t("product.createProject")}</ActionButton>
            ) : null}
          </span>
        </Notice>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("product.backlog.projectHint")}{" "}
          <Link href={`/${locale}/projects/${b.projectId}/board`} className="text-primary hover:underline">
            {t("product.backlog.openBoard")}
          </Link>
          {" · "}
          <Link href={`/${locale}/projects/${b.projectId}/sprints`} className="text-primary hover:underline">
            {t("product.backlog.openSprints")}
          </Link>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("product.backlog.byFeature")} description={t("product.backlog.byFeatureHint")} />
          {b.features.length ? (
            <ul className="grid divide-y">
              {b.features.map((f) => (
                <li key={f.id} className="grid gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/${locale}/product/features/${f.id}`} className="font-medium hover:underline">
                      {f.title}
                    </Link>
                    <Badge tone={ITEM_TONE[f.status]}>{t(`work.itemStatus.${f.status}`)}</Badge>
                    {f.riceScore != null ? <Badge>RICE {f.riceScore}</Badge> : null}
                    {canEdit && b.projectId ? (
                      <span className="ms-auto">
                        <PushToSprint base={base} productId={productId} featureId={f.id} sprints={sprints} />
                      </span>
                    ) : null}
                  </div>
                  {f.tasks.length ? <ul className="ps-2">{f.tasks.map(task)}</ul> : <p className="text-xs text-muted-foreground">{t("work.product.noLinkedTasks")}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{t("work.product.noFeatures")}</Empty>
          )}
        </Card>
        <div className="grid content-start gap-4">
          {canEdit && b.projectId ? (
            <Card>
              <CardHeader title={t("product.backlog.add")} />
              <BacklogForm base={base} productId={productId} features={b.features.map((f) => ({ id: f.id, name: f.title }))} sprints={sprints} />
            </Card>
          ) : null}
          <AiPanel
            t={t}
            locale={locale}
            tz={tz}
            title={t("product.backlog.aiTitle")}
            description={t("product.backlog.aiHint")}
            configured={aiConfigured()}
            tasks={aiTasks}
            actions={canRunAgents && canEdit ? <AiButton url={`${base}/product/products/${productId}/plan/apply`} label={t("product.plan.apply")} /> : null}
          />
          {b.unlinked.length ? (
            <Card>
              <CardHeader title={t("product.backlog.unlinked")} />
              <CardBody>
                <ul>{b.unlinked.map(task)}</ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
