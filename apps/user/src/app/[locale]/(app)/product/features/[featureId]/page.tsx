import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton } from "@/components/work/actions";
import { workContext } from "@/components/work/context";
import { FeatureForm } from "@/components/work/product-forms";
import { NewTaskForm } from "@/components/work/task-forms";
import { Facts, ITEM_TONE, STATUS_TONE } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { featurePickers, getFeature, quarterOptions } from "@/server/modules/work/product";
import { productOptions } from "@/server/modules/work/product-core";
import { listPeople } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.feature") };
}

export default async function FeaturePage({ params }: PageProps<"/[locale]/product/features/[featureId]">) {
  const { featureId } = await params;
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const f = await getFeature(viewer.ctx, org.id, company.id, featureId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [pickers, people, products] = await Promise.all([featurePickers(org.id, company.id), canManage ? listPeople(viewer.ctx, org.id, company.id) : [], productOptions(org.id, company.id)]);
  if (f.release && !pickers.releases.some((r) => r.id === f.release!.id)) pickers.releases.push({ id: f.release.id, name: f.release.version });
  const n = (v: number | null) => (v == null ? "" : String(v));
  return (
    <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={f.product ? `/${locale}/product/${f.product.id}/features` : `/${locale}/product/features`} className="text-sm text-muted-foreground hover:underline">
          ← {f.product ? `${f.product.name} · ${t("work.product.tabs.features")}` : t("work.product.tabs.features")}
        </Link>
        {canManage ? (
          <ActionButton url={`${base}/product/features/${f.id}`} method="PATCH" body={{ archived: !f.archivedAt }} confirm={f.archivedAt ? undefined : t("work.confirmArchive")}>
            {f.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {f.archivedAt ? t("work.restore") : t("work.archive")}
          </ActionButton>
        ) : null}
      </div>
      {f.archivedAt ? <Notice tone="warning">{t("work.archivedNotice")}</Notice> : null}
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {f.title}
              <Badge tone={ITEM_TONE[f.status]}>{t(`work.itemStatus.${f.status}`)}</Badge>
              {f.riceScore != null ? <Badge>RICE {f.riceScore}</Badge> : null}
            </span>
          }
        />
        <CardBody className="grid gap-4">
          <Facts
            cols={5}
            items={[
              [t("product.product"), f.product ? <Link key="pr" href={`/${locale}/product/${f.product.id}`} className="hover:underline">{f.product.name}</Link> : "—"],
              [t("work.product.initiative"), f.initiative?.title ?? "—"],
              [t("work.product.quarter"), f.quarter ?? t("work.product.unscheduled")],
              [t("work.product.release"), f.release ? `${f.release.version} · ${t(`work.releaseStatus.${f.release.status}`)}` : "—"],
              [t("work.task.project"), f.project ? <Link key="p" href={`/${locale}/projects/${f.project.id}`} className="hover:underline">{f.project.name}</Link> : "—"],
            ]}
          />
          {canManage ? (
            <FeatureForm
              base={base}
              locale={locale}
              featureId={f.id}
              quarters={quarterOptions()}
              {...pickers}
              products={products}
              initial={{
                title: f.title,
                spec: f.spec ?? "",
                status: f.status,
                quarter: f.quarter ?? "",
                initiativeId: f.initiativeId ?? "",
                projectId: f.projectId ?? "",
                releaseId: f.releaseId ?? "",
                reach: n(f.reach),
                impact: n(f.impact),
                confidence: n(f.confidence),
                effort: n(f.effort),
                productId: f.productId ?? "",
                requirements: f.requirements ?? "",
                acceptanceCriteria: f.acceptanceCriteria ?? "",
              }}
            />
          ) : (
            <div className="grid gap-3 text-sm">
              {f.spec ? <div className="whitespace-pre-wrap">{f.spec}</div> : <p className="text-muted-foreground">{t("work.product.noSpec")}</p>}
              {f.requirements ? (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">{t("product.feature.requirements")}</h3>
                  <div className="whitespace-pre-wrap">{f.requirements}</div>
                </div>
              ) : null}
              {f.acceptanceCriteria ? (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">{t("product.feature.acceptance")}</h3>
                  <ul className="list-disc ps-5">
                    {f.acceptanceCriteria
                      .split("\n")
                      .filter((l) => l.trim())
                      .map((l, i) => (
                        <li key={i}>{l.replace(/^[-*]\s*/, "")}</li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("work.product.linkedTasks")} description={t("work.task.count", { count: f.tasks.length })} />
        {f.tasks.length ? (
          <ul className="grid divide-y">
            {f.tasks.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={STATUS_TONE[x.status]}>{t(`work.taskStatus.${x.status}`)}</Badge>
                <Link href={`/${locale}/projects/tasks/${x.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {x.title}
                </Link>
                <span className="text-xs text-muted-foreground">{x.assignee?.name ?? ""}</span>
                <span className="text-xs text-muted-foreground">{x.dueDate ? formatDate(x.dueDate, locale, "UTC") : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("work.product.noLinkedTasks")}</p>
        )}
        {canManage && !f.archivedAt ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.task.add")}</summary>
            <NewTaskForm base={base} people={people} projects={pickers.projects} projectId={f.projectId ?? undefined} defaults={{ featureId: f.id, title: "" }} features={[{ id: f.id, name: f.title }]} />
          </details>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("work.product.tabs.feedback")} description={t("work.product.feedbackCount", { count: f.feedback.length })} />
          {f.feedback.length ? (
            <ul className="grid divide-y">
              {f.feedback.map((x) => (
                <li key={x.id} className="grid gap-0.5 px-4 py-2 text-sm">
                  <span className="flex gap-2 text-xs text-muted-foreground">
                    <Badge>{x.source}</Badge>
                    {formatDateTime(x.createdAt, locale, tz)}
                  </span>
                  <p className="whitespace-pre-wrap">{x.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("work.product.noFeedback")}</p>
          )}
        </Card>
        <Card>
          <CardHeader title={t("work.product.tabs.ideas")} />
          {f.ideas.length ? (
            <ul className="grid divide-y">
              {f.ideas.map((x) => (
                <li key={x.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  <Badge>{t("work.product.votes", { count: x.voteCount })}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("work.product.noIdeasLinked")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
