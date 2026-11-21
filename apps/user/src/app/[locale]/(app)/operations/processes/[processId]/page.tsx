import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { workContext } from "@/components/work/context";
import { ProcessMetaForm, ProcessVersionForm } from "@/components/work/ops-forms";
import { Facts } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getProcess } from "@/server/modules/work/operations";
import { listPeople, param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.process") };
}

export default async function ProcessPage({ params, searchParams }: PageProps<"/[locale]/operations/processes/[processId]">) {
  const { processId } = await params;
  const raw = await searchParams;
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, canRunAgents, base, tz } = w;
  const v = Number(param(raw, "v"));
  const p = await getProcess(viewer.ctx, org.id, company.id, processId, Number.isInteger(v) && v > 0 ? v : undefined).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [people, sopTasks] = await Promise.all([
    canManage ? listPeople(viewer.ctx, org.id, company.id, "operations.read") : [],
    canRunAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "ops_process", p.id, 5) : [],
  ]);
  const latest = p.shown?.version === p.currentVersion;
  return (
    <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/operations/processes`} className="text-sm text-muted-foreground hover:underline">
          ← {t("work.ops.tabs.processes")}
        </Link>
        {canManage ? (
          <ActionButton url={`${base}/operations/processes/${p.id}`} method="PATCH" body={{ archived: !p.archivedAt }} confirm={p.archivedAt ? undefined : t("work.confirmArchive")}>
            {p.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {p.archivedAt ? t("work.restore") : t("work.archive")}
          </ActionButton>
        ) : null}
      </div>
      {p.archivedAt ? <Notice tone="warning">{t("work.archivedNotice")}</Notice> : null}
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {p.title}
              {p.category ? <Badge>{p.category}</Badge> : null}
              <Badge tone="accent">v{p.shown?.version ?? p.currentVersion}</Badge>
            </span>
          }
        />
        <CardBody className="grid gap-4">
          <Facts items={[[t("work.ops.owner"), p.ownerName ?? "—"], [t("work.ops.version"), `v${p.currentVersion}`], [t("work.ops.updated"), formatDateTime(p.updatedAt, locale, tz)]]} />
          {p.description ? <p className="whitespace-pre-wrap text-sm">{p.description}</p> : null}
          {!latest ? <Notice tone="info">{t("work.ops.oldVersion", { version: p.shown?.version ?? 0, current: p.currentVersion })}</Notice> : null}
          {p.shown ? (
            <ol className="grid gap-3">
              {p.shown.steps.map((s, i) => (
                <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 text-sm">
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold">{i + 1}</span>
                  <div className="grid gap-0.5">
                    <span className="font-medium">{s.title}</span>
                    {s.detail ? <p className="whitespace-pre-wrap text-muted-foreground">{s.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </CardBody>
      </Card>
      {canRunAgents && canManage && !p.archivedAt ? (
        <AiPanel
          t={t}
          locale={locale}
          tz={tz}
          title={t("work.opsAnalytics.sopTitle")}
          description={t("work.opsAnalytics.sopHint")}
          configured={aiConfigured()}
          tasks={sopTasks}
          actions={<AiButton url={`${base}/operations/processes/${p.id}/sop`} label={t("work.opsAnalytics.sopRun")} />}
        />
      ) : null}
      {canManage && !p.archivedAt ? (
        <>
          <Card>
            <CardHeader title={t("work.ops.editSteps")} description={t("work.ops.editStepsHint")} />
            <CardBody>
              <ProcessVersionForm key={p.currentVersion} base={base} processId={p.id} initial={(p.shown?.steps ?? []).map((s) => ({ title: s.title, detail: s.detail ?? "" }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("work.ops.details")} />
            <CardBody>
              <ProcessMetaForm base={base} processId={p.id} people={people} initial={{ title: p.title, description: p.description ?? "", category: p.category ?? "", ownerId: p.ownerId ?? "" }} />
            </CardBody>
          </Card>
        </>
      ) : null}
      <Card>
        <CardHeader title={t("work.ops.history")} />
        <ul className="grid divide-y">
          {p.versions.map((ver) => (
            <li key={ver.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <Link href={`/${locale}/operations/processes/${p.id}?v=${ver.version}`} className="font-medium hover:underline">
                v{ver.version}
              </Link>
              {ver.version === p.currentVersion ? <Badge tone="success">{t("work.ops.current")}</Badge> : null}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{ver.changeNote ?? ""}</span>
              <span className="text-xs text-muted-foreground">
                {ver.createdByName ?? ""} · {formatDateTime(ver.createdAt, locale, tz)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
