import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clapperboard, Download, Film, Settings2, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { studioPage } from "@/components/creative/context";
import { PipelineRail } from "@/components/creative/graphics";
import { DeleteButton, HandoffForm, MusicPanel, ProjectSettingsForm, ReviewPanel, StepActions, StoryboardEditor, TextStepEditor } from "@/components/creative/client";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getProject } from "@/server/modules/creative/pipeline";
import { studioOverview } from "@/server/modules/creative/library";
import { listAccounts } from "@/server/modules/marketing/social";
import { formatMicros, SKIPPABLE, STEP_DEPENDS, STEP_TONE, type PipelineStep, type StepStatus } from "@/server/modules/creative/presets";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("creative.project.title") };
}

const STATUS_TONE = { DRAFT: "neutral", IN_PROGRESS: "accent", IN_REVIEW: "warning", APPROVED: "success", EXPORTED: "success", ARCHIVED: "neutral" } as const;
type Out = Record<string, unknown> | null;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export default async function StudioProjectPage({ params }: PageProps<"/[locale]/studio/projects/[projectId]">) {
  const { projectId } = await params;
  const p = await studioPage("project");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  let project: Awaited<ReturnType<typeof getProject>>;
  try {
    project = await getProject(viewer.ctx, org.id, company.id, projectId);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  const [overview, social] = await Promise.all([studioOverview(viewer.ctx, org.id, company.id), perms.manage ? listAccounts(viewer.ctx, org.id, company.id) : Promise.resolve({ accounts: [] })]);
  const steps = project.steps;
  const statusOf = (k: PipelineStep) => (steps.find((s) => s.key === k)?.status ?? "PENDING") as StepStatus;
  const ready = (k: PipelineStep) => STEP_DEPENDS[k].every((d) => ["SUCCEEDED", "SKIPPED"].includes(statusOf(d)));
  const active = steps.some((s) => s.status === "RUNNING" || s.status === "WAITING_PROVIDER") || project.scenes.some((s) => s.status === "GENERATING");
  const byRole = (role: string) => project.assets.filter((a) => a.role === role && !a.archivedAt);
  const renders = byRole("render");
  const mainRender = renders.find((r) => r.preset === project.aspect) ?? null;
  const thumb = byRole("thumbnail")[0] ?? null;
  const voice = byRole("voiceover")[0] ?? null;
  const music = byRole("music")[0] ?? null;
  const dl = (id: unknown, label: string) =>
    typeof id === "string" ? (
      <a href={`${base}/creative/library/${id}/download`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <Download aria-hidden className="size-3.5" />
        {label}
      </a>
    ) : null;
  const done = steps.filter((s) => s.status === "SUCCEEDED" || s.status === "SKIPPED").length;
  const settings = project.settings;
  const locked = project.scenes.some((s) => s.status === "GENERATING");

  const detail = (key: PipelineStep, out: Out) => {
    const st = statusOf(key);
    switch (key) {
      case "idea":
        return <p className="whitespace-pre-wrap text-sm">{project.brief}</p>;
      case "research":
        return Array.isArray(out?.results) ? (
          <ul className="grid gap-1 text-xs">
            {(out.results as { title: string; url: string }[]).map((r, i) => (
              <li key={r.url}>
                [{i + 1}]{" "}
                <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {r.title}
                </a>
              </li>
            ))}
          </ul>
        ) : null;
      case "concept":
      case "script":
      case "hook":
        return out && typeof out.text === "string" ? <TextStepEditor key={`${key}-${steps.find((s) => s.key === key)?.updatedAt.toISOString()}`} base={base} projectId={project.id} step={key} value={out.text} options={key === "hook" && Array.isArray(out.options) ? (out.options as string[]) : undefined} canManage={perms.manage} /> : null;
      case "storyboard":
        return project.scenes.length ? <p className="text-xs text-muted-foreground">{t("creative.storyboard.summary", { count: project.scenes.length, seconds: Math.round(project.scenes.reduce((a, s) => a + s.seconds, 0)) })} · <a href="#storyboard" className="text-primary hover:underline">{t("creative.storyboard.open")}</a></p> : null;
      case "scene_assets":
        return project.scenes.length ? (
          <div className="grid gap-1 text-xs text-muted-foreground">
            <span>{t("creative.scenes.progress", { ready: project.scenes.filter((s) => s.status === "READY").length, total: project.scenes.length })}</span>
            {project.scenes.filter((s) => s.status === "FAILED").map((s) => (
              <span key={s.id} className="text-danger">
                {t("creative.scenes.failed", { n: s.position, error: s.error ?? "" })}
              </span>
            ))}
          </div>
        ) : null;
      case "voiceover":
        return voice?.file?.previewUrl ? (
          <div className="grid gap-1">
            <audio src={voice.file.previewUrl} controls preload="none" className="h-9 w-full max-w-md" aria-label={t("creative.steps.names.voiceover")} />
            <span className="text-xs text-muted-foreground">
              {t("creative.voiceover.meta", { seconds: Math.round(Number(out?.duration ?? 0)), voice: str(out?.voice) })} · {out?.timing === "provider" ? t("creative.voiceover.timingExact") : t("creative.voiceover.timingEstimated")}
            </span>
          </div>
        ) : null;
      case "music":
        return (
          <div className="grid gap-3">
            {music ? (
              <div className="grid gap-1 text-xs">
                <span className="font-medium">{music.name}</span>
                {music.file?.previewUrl ? <audio src={music.file.previewUrl} controls preload="none" className="h-8 w-full max-w-md" aria-label={music.name} /> : null}
                <span className="text-muted-foreground">{t("creative.music.licensed", { license: str((music.license as Record<string, unknown> | null)?.attribution) || str((music.license as Record<string, unknown> | null)?.note) || "—" })}</span>
              </div>
            ) : null}
            {perms.manage && st !== "SKIPPED" ? <MusicPanel base={base} projectId={project.id} locale={locale} canManage={perms.manage} integrationsHref={perms.integrations ? `/${locale}/integrations/jamendo` : null} /> : null}
          </div>
        );
      case "captions":
        return out ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{t("creative.captions.cues", { count: Array.isArray(out.cues) ? out.cues.length : 0 })}</span>
            <span>{out.timing === "provider" ? t("creative.voiceover.timingExact") : t("creative.voiceover.timingEstimated")}</span>
            {dl(out.srtAssetId, "SRT")}
            {dl(out.vttAssetId, "VTT")}
          </div>
        ) : null;
      case "assembly":
        return (
          <div className="grid gap-2">
            {mainRender?.file?.previewUrl ? (
              <video src={mainRender.file.previewUrl} controls playsInline className={cn("w-full rounded-md bg-black", project.aspect === "9:16" ? "max-w-xs" : "max-w-xl")} aria-label={t("creative.assembly.render")} />
            ) : out ? (
              <Notice tone={out.note === "render_requires_provider" ? "info" : "warning"} action={out.note === "render_requires_provider" && perms.integrations ? <Link href={`/${locale}/integrations/shotstack`} className="text-sm font-medium text-primary hover:underline">{t("creative.common.connect")}</Link> : undefined}>
                {st === "WAITING_PROVIDER" ? t("creative.assembly.rendering") : t(`creative.assembly.notes.${str(out.note) || "render_requires_provider"}`)}
              </Notice>
            ) : null}
            {out ? (
              <div className="flex flex-wrap gap-3">
                {dl(out.timelineAssetId, t("creative.assembly.timeline"))}
                {dl(out.edlAssetId, t("creative.assembly.edl"))}
                {mainRender ? dl(mainRender.id, t("creative.assembly.mp4")) : null}
              </div>
            ) : null}
          </div>
        );
      case "thumbnail":
        return thumb?.file?.previewUrl ? (
          <Link href={`/${locale}/studio/library/${thumb.id}`} className="block w-48 overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            <img src={thumb.file.previewUrl} alt={t("creative.steps.names.thumbnail")} className="w-full object-cover" loading="lazy" />
          </Link>
        ) : null;
      case "variants":
        return Array.isArray(out?.variants) ? (
          <ul className="grid gap-1 text-xs">
            {(out.variants as Record<string, unknown>[]).map((v) => {
              const r = renders.find((x) => x.preset === v.aspect);
              const jobs = Array.isArray(v.jobs) ? (v.jobs as { status: string }[]) : [];
              return (
                <li key={str(v.aspect)} className="flex flex-wrap items-center gap-2">
                  <Badge>{str(v.aspect)}</Badge>
                  {r ? dl(r.id, t("creative.assembly.mp4")) : <span className="text-muted-foreground">{jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING") ? t("creative.assembly.rendering") : t(`creative.assembly.notes.${str(v.note) || "render_requires_provider"}`)}</span>}
                  {dl(v.timelineAssetId, t("creative.assembly.timeline"))}
                </li>
              );
            })}
          </ul>
        ) : null;
      case "review":
        return st === "NEEDS_INPUT" && perms.manage ? (
          <ReviewPanel base={base} projectId={project.id} />
        ) : project.reviewNote ? (
          <p className="text-xs text-muted-foreground">{t("creative.review.lastNote", { note: project.reviewNote })}</p>
        ) : null;
      case "export":
        return out ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{out.finishedVideo ? t("creative.export.withVideo") : t("creative.export.timelineOnly")}</span>
            {dl(out.manifestAssetId, t("creative.export.manifest"))}
          </div>
        ) : null;
      case "handoff":
        return perms.manage && (project.status === "APPROVED" || project.status === "EXPORTED") && st !== "SUCCEEDED" ? (
          <HandoffForm base={base} projectId={project.id} accounts={social.accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider, connected: !!a.connected }))} hasRender={!!mainRender} defaultTitle={project.name} locale={locale} />
        ) : st === "SUCCEEDED" ? (
          <p className="text-xs text-muted-foreground">
            {t("creative.handoff.done")}{" "}
            <Link href={`/${locale}/marketing/social`} className="text-primary hover:underline">
              {t("creative.handoff.open")}
            </Link>
          </p>
        ) : null;
    }
  };

  const visuals = project.assets.filter((a) => (a.kind === "IMAGE" || a.kind === "VIDEO") && !a.archivedAt);
  return wrap(
    <>
      <AutoRefresh active={active} intervalMs={6000} />
      <Link href={`/${locale}/studio`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("creative.project.back")}
      </Link>
      <Card variant="highlight">
        <CardHeader
          icon={<Clapperboard />}
          title={project.name}
          description={`${project.aspect} · ${project.targetSeconds}s${project.platforms.length ? ` · ${project.platforms.map((x) => t(`creative.platforms.${x}`)).join(", ")}` : ""}`}
          actions={
            <span className="flex items-center gap-2">
              {active ? <Badge tone="info" pulse>{t("creative.projects.working")}</Badge> : null}
              <Badge tone={STATUS_TONE[project.status]}>{t(`creative.status.${project.status}`)}</Badge>
            </span>
          }
        />
        <CardBody className="grid gap-3">
          <PipelineRail label={t("creative.projects.progress", { done, total: steps.length })} steps={steps.map((s) => ({ key: s.key, status: s.status }))} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>{t("creative.projects.progress", { done, total: steps.length })}</span>
            <span>{t("creative.projects.cost", { cost: formatMicros(project.costMicros) })}</span>
            {project.autoAdvance ? <span className="text-primary">{t("creative.project.autoOn")}</span> : null}
            <span>{formatDateTime(project.updatedAt, locale, tz)}</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Film />} title={t("creative.project.pipeline")} description={t("creative.project.pipelineHint")} />
          <CardBody className="p-0">
            <ol className="divide-y">
              {steps.map((s, i) => {
                const key = s.key as PipelineStep;
                const st = s.status as StepStatus;
                return (
                  <li key={s.id} className="grid gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full border text-xs tabular-nums", st === "SUCCEEDED" ? "border-success/40 bg-success/10 text-success" : st === "RUNNING" || st === "WAITING_PROVIDER" ? "border-primary/40 bg-primary/10 text-primary" : "")}>
                          {i + 1}
                        </span>
                        <div className="grid min-w-0 gap-0.5">
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            {t(`creative.steps.names.${key}`)}
                            <Badge tone={STEP_TONE[st]} pulse={st === "RUNNING" || st === "WAITING_PROVIDER"}>
                              {t(`creative.stepStatus.${st}`)}
                            </Badge>
                            {s.edited ? <Badge tone="info">{t("creative.steps.edited")}</Badge> : null}
                            {s.costMicros !== null && s.costMicros > 0n ? <span className="text-xs font-normal text-muted-foreground">{formatMicros(s.costMicros)}</span> : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{t(`creative.steps.desc.${key}`)}</span>
                        </div>
                      </div>
                      {perms.manage ? <StepActions base={base} projectId={project.id} step={key} status={st} skippable={SKIPPABLE.includes(key)} ready={ready(key)} /> : null}
                    </div>
                    {s.error && st !== "SUCCEEDED" ? <Notice tone={st === "FAILED" ? "danger" : "warning"}>{s.error}</Notice> : null}
                    {detail(key, (s.output ?? null) as Out)}
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Wallet />} title={t("creative.costs.projectTitle")} description={t("creative.costs.estimates")} />
            <CardBody className="grid gap-1.5 text-sm">
              {steps.filter((s) => s.costMicros !== null && s.costMicros > 0n).map((s) => (
                <div key={s.id} className="flex justify-between gap-2">
                  <span>{t(`creative.steps.names.${s.key}`)}</span>
                  <span className="tabular-nums">{formatMicros(s.costMicros)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t pt-2 font-medium">
                <span>{t("creative.costs.total")}</span>
                <span className="tabular-nums">{formatMicros(project.costMicros)}</span>
              </div>
            </CardBody>
          </Card>
          {perms.manage ? (
            <Card>
              <CardHeader icon={<Settings2 />} title={t("creative.settings.title")} />
              <CardBody className="grid gap-3">
                <ProjectSettingsForm
                  base={base}
                  projectId={project.id}
                  connected={overview.connected}
                  value={{ autoAdvance: project.autoAdvance, voiceProvider: settings.voiceProvider ?? null, voice: settings.voice ?? null, voiceStyle: settings.voiceStyle ?? null, videoProvider: settings.videoProvider ?? null, renderProvider: settings.renderProvider ?? null, research: !!settings.research }}
                />
                <div className="border-t pt-3">
                  <DeleteButton path={`${base}/creative/projects/${project.id}`} label={t("creative.project.archive")} confirm={t("creative.project.archiveConfirm")} after={`/${locale}/studio`} />
                </div>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("creative.project.assets")} description={t("creative.project.assetsHint")} />
            <CardBody>
              {visuals.length ? (
                <ul className="grid grid-cols-3 gap-2">
                  {visuals.slice(0, 18).map((a) => (
                    <li key={a.id}>
                      <Link href={`/${locale}/studio/library/${a.id}`} className="block aspect-square overflow-hidden rounded-md border bg-muted" title={a.name}>
                        {a.kind === "IMAGE" && a.file?.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                          <img src={a.file.previewUrl} alt={a.name} className="size-full object-cover" loading="lazy" />
                        ) : (
                          <span className="grid size-full place-items-center text-muted-foreground">
                            <Film aria-hidden className="size-5" />
                            <span className="sr-only">{a.name}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("creative.project.noAssets")}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <section id="storyboard" className="scroll-mt-24">
        <Card>
          <CardHeader title={t("creative.storyboard.title")} description={t("creative.storyboard.description")} />
          <CardBody>
            {project.scenes.length ? (
              <StoryboardEditor
                key={project.scenes.map((s) => `${s.id}:${s.status}:${s.assetId ?? ""}`).join("|")}
                base={base}
                projectId={project.id}
                canManage={perms.manage}
                locked={locked}
                scenes={project.scenes.map((s) => ({ id: s.id, title: s.title, shot: s.shot, narration: s.narration, onScreenText: s.onScreenText, seconds: s.seconds, media: s.media, previewUrl: s.file?.previewUrl ?? null, isVideo: !!s.file && s.media === "video" && s.status === "READY", status: s.status, error: s.error }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("creative.storyboard.empty")}</p>
            )}
          </CardBody>
        </Card>
      </section>
    </>,
  );
}
