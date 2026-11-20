import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButton } from "@/components/work/actions";
import { CreateAndOpen, GateChecklist, HireTeam, ProductEditor, StageMover } from "@/components/work/product-client";
import { productWorkspace } from "@/components/work/product-ui";
import { HelpStrip, JourneyMap, LifecycleRail, ReadinessGauge } from "@/components/work/product-studio";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { launchReadiness, productJourney, productVisuals, stageDeliverables } from "@/server/modules/work/product-journey";
import { DeliverablesMap } from "@/components/product-studio/deliverables-map";
import { ProductGraph, ProgressionFunnel } from "@/components/work/product-visuals";
import { Facts, StatCard } from "@/components/work/ui";
import { formatDate, formatDateTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getProduct, PRODUCT_STAGES, productFormPickers, stageIndex } from "@/server/modules/work/product-core";
import { PRODUCT_TEAM_PROFILES, productConnections } from "@/server/modules/work/product-delivery";
import { listPeople } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.workspace.tabs.overview") };
}

export default async function ProductOverviewPage({ params }: PageProps<"/[locale]/product/[productId]">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "overview");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, tz, canEdit, canManage } = w;
  const chain = await companyChain(db(), org.id, company.id);
  const [visuals, journey, readiness, p, links, pickers, people, canHire, deliverables] = await Promise.all([
    productVisuals(viewer.ctx, org.id, company.id, productId),
    productJourney(viewer.ctx, org.id, company.id, productId),
    launchReadiness(viewer.ctx, org.id, company.id, productId),
    getProduct(viewer.ctx, org.id, company.id, productId),
    productConnections(viewer.ctx, org.id, company.id, productId),
    canManage ? productFormPickers(org.id, company.id) : { entities: [], projects: [] },
    canManage ? listPeople(viewer.ctx, org.id, company.id) : [],
    can(viewer.ctx, "agents.manage", chain),
    stageDeliverables(viewer.ctx, org.id, company.id, productId),
  ]);
  const ws = `/${locale}/product/${p.id}`;
  const i = stageIndex(p.stage);
  const next = PRODUCT_STAGES[i + 1] ?? null;
  const isOwner = !p.ownerId || p.ownerId === viewer.ctx.actor.id;
  const allDone = p.gate.items.every((x) => x.done);
  const itemLabel = (x: { key?: string; label?: string }) => (x.key ? t(`product.gate.items.${x.key}`) : (x.label ?? ""));
  const hired = new Set(links.aiTeam.map((e) => e.profileKey));
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <HelpStrip
        t={t}
        area="overview"
        action={
          canEdit && w.canRunAgents && aiConfigured() && journey.plan?.status !== "RUNNING" ? (
            <AiButton url={`${base}/product/products/${p.id}/plan`} label={t("product.journey.helpAll")} />
          ) : journey.plan?.status === "RUNNING" ? (
            <Link href={`${ws}/plan`} className="text-xs text-primary hover:underline">
              {t("product.plan.running")}
            </Link>
          ) : null
        }
      />
      <Card variant="glass" className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("product.journey.title")}</h2>
          <span className="text-xs text-muted-foreground">{t("product.journey.overall", { percent: journey.overall })}</span>
        </div>
        <LifecycleRail t={t} stage={p.stage} />
        <AnimatedProgress value={journey.overall} label={t("product.journey.overall", { percent: journey.overall })} active={journey.plan?.status === "RUNNING"} />
      </Card>
      <JourneyMap t={t} locale={locale} base={base} productId={p.id} journey={journey} canEdit={canEdit} canAi={w.canRunAgents && aiConfigured()} />
      <Card variant="elevated">
        <CardHeader title={t("productStudio.deliverables.title")} description={t("productStudio.deliverables.hint", { saved: deliverables.saved, total: deliverables.total })} />
        <CardBody>
          <DeliverablesMap t={t} locale={locale} tz={tz} base={base} ws={ws} data={deliverables} canEdit={canEdit} canAi={w.canRunAgents && aiConfigured()} />
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={t("product.lifecycle")}
            description={t("product.stageSince", { stage: t(`product.stages.${p.stage}`), date: formatDate(p.stageEnteredAt, locale, tz) })}
          />
          <CardBody className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid content-start gap-2">
                <h3 className="text-sm font-medium">{t("product.gate.title", { stage: t(`product.stages.${p.stage}`) })}</h3>
                <GateChecklist base={base} productId={p.id} canEdit={canEdit} items={p.gate.items.map((x) => ({ id: x.id, label: itemLabel(x), done: x.done, custom: !x.key }))} />
              </div>
              <div className="grid content-start gap-3">
                {p.gate.approvedAt ? (
                  <Notice tone="success">{t("product.gate.approvedBy", { name: p.gate.approvedByName ?? "—", date: formatDateTime(p.gate.approvedAt, locale, tz) })}</Notice>
                ) : (
                  <p className="text-sm text-muted-foreground">{p.ownerName ? t("product.gate.ownerApproves", { name: p.ownerName }) : t("product.gate.managerApproves")}</p>
                )}
                {canEdit && isOwner ? (
                  p.gate.approvedAt ? (
                    <ActionButton url={`${base}/product/products/${p.id}/gate/approve`} body={{ approve: false }} variant="ghost">
                      {t("product.gate.reopen")}
                    </ActionButton>
                  ) : (
                    <ActionButton url={`${base}/product/products/${p.id}/gate/approve`} body={{ approve: true }} variant={allDone ? "default" : "secondary"}>
                      {t("product.gate.approve")}
                    </ActionButton>
                  )
                ) : null}
                {canEdit ? (
                  <StageMover
                    base={base}
                    productId={p.id}
                    canAdvance={!!p.gate.approvedAt}
                    nextLabel={next ? t(`product.stages.${next}`) : null}
                    earlier={PRODUCT_STAGES.slice(0, i).map((s) => ({ value: s, label: t(`product.stages.${s}`) }))}
                  />
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t("product.workspace.tabs.overview")}
            actions={
              canManage ? (
                <span className="flex flex-wrap gap-1">
                  {!p.archivedAt ? (
                    <ProductEditor
                      base={base}
                      locale={locale}
                      productId={p.id}
                      people={people}
                      entities={pickers.entities}
                      projects={pickers.projects}
                      initial={{ name: p.name, description: p.description ?? "", targetUsers: p.targetUsers ?? "", status: p.status, ownerId: p.ownerId ?? "", graphEntityId: p.graphEntityId ?? "", developmentProjectId: p.developmentProjectId ?? "" }}
                    />
                  ) : null}
                  <ActionButton url={`${base}/product/products/${p.id}`} method="PATCH" body={{ archived: !p.archivedAt }} variant="ghost" confirm={p.archivedAt ? undefined : t("work.confirmArchive")}>
                    {p.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                    {p.archivedAt ? t("work.restore") : t("work.archive")}
                  </ActionButton>
                </span>
              ) : null
            }
          />
          <CardBody className="grid gap-4">
            <Facts
              cols={2}
              items={[
                [t("product.fields.owner"), p.ownerName ?? "—"],
                [t("product.fields.targetUsers"), p.targetUsers ?? "—"],
                [
                  t("product.fields.graphEntity"),
                  p.graphEntity ? (
                    <Link key="g" href={`/${locale}/graph/${p.graphEntity.id}`} className="hover:underline">
                      {p.graphEntity.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                [
                  t("product.fields.project"),
                  p.project ? (
                    <Link key="p" href={`/${locale}/projects/${p.project.id}`} className="hover:underline">
                      {p.project.name}
                    </Link>
                  ) : canEdit ? (
                    <ActionButton key="cp" url={`${base}/product/products/${p.id}/project`}>
                      {t("product.createProject")}
                    </ActionButton>
                  ) : (
                    "—"
                  ),
                ],
                [
                  t("product.launchCampaign"),
                  links.campaign ? (
                    <Link key="c" href={`/${locale}/marketing/campaigns/${links.campaign.id}`} className="inline-flex items-center gap-1 hover:underline">
                      {links.campaign.name}
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  ) : canEdit && links.canMarketing ? (
                    <CreateAndOpen key="mc" url={`${base}/product/products/${p.id}/campaign`} hrefPrefix={`/${locale}/marketing/campaigns/`} label={t("product.createCampaign")} />
                  ) : (
                    "—"
                  ),
                ],
                [t("product.aiTasks"), links.canAgents ? String(links.aiTasks) : "—"],
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Link href={`${ws}/features`}><StatCard label={t("work.product.tabs.features")} value={p.counts.features} /></Link>
        <Link href={`${ws}/documents`}><StatCard label={t("product.workspace.tabs.documents")} value={p.counts.docs} /></Link>
        <Link href={`${ws}/research`}><StatCard label={t("product.research.competitors")} value={p.counts.competitors} /></Link>
        <Link href={`${ws}/research`}><StatCard label={t("product.research.validations")} value={p.counts.validations} /></Link>
        <Link href={`${ws}/releases`}><StatCard label={t("work.product.tabs.releases")} value={p.counts.releases} /></Link>
        <Link href={`${ws}/feedback`}><StatCard label={t("work.product.tabs.feedback")} value={p.counts.feedback} /></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card variant="elevated">
          <CardHeader title={t(visuals.components.length >= 2 ? "product.visuals.archTitle" : "product.visuals.mapTitle")} />
          <CardBody>
            <ProductGraph name={visuals.name} components={visuals.components} initiatives={visuals.initiatives} features={visuals.features} />
          </CardBody>
        </Card>
        <Card variant="elevated">
          <CardHeader title={t("product.visuals.funnelTitle")} description={t("product.visuals.funnelHint")} />
          <CardBody>
            <ProgressionFunnel steps={visuals.funnel} />
          </CardBody>
        </Card>
      </div>

      <Card variant="elevated">
        <CardHeader title={t("product.readiness.title")} description={t("product.readiness.hint")} />
        <CardBody>
          <ReadinessGauge t={t} readiness={readiness} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("product.history")} />
          {p.history.length ? (
            <ul className="grid divide-y text-sm">
              {p.history.map((h) => (
                <li key={h.id} className="grid gap-0.5 px-4 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.exitedAt ? "neutral" : "accent"}>{t(`product.stages.${h.stage}`)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(h.enteredAt, locale, tz)} → {h.exitedAt ? formatDate(h.exitedAt, locale, tz) : t("product.now")}
                    </span>
                    <span className="text-xs text-muted-foreground">{h.changedByName ?? ""}</span>
                  </span>
                  {h.note ? <span className="text-xs">{h.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("product.noHistory")}</p>
          )}
        </Card>
        <Card>
          <CardHeader title={t("product.team.title")} description={t("product.team.hint")} />
          <CardBody className="grid gap-3">
            {links.aiTeam.length ? (
              <ul className="flex flex-wrap gap-1">
                {links.aiTeam.map((e) => (
                  <li key={e.id}>
                    <Link href={`/${locale}/workforce/${e.id}`}>
                      <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{e.name}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("product.team.none")}</p>
            )}
            {canHire ? <HireTeam base={base} profiles={PRODUCT_TEAM_PROFILES.map((k) => ({ key: k, label: t(`profiles.${k}.name`), hired: hired.has(k) }))} /> : null}
            <Link href={`${ws}/plan`} className="text-sm text-primary hover:underline">
              {t("product.plan.open")}
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
