import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Circle, Clapperboard, ImageIcon, Library, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/comms/bits";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { studioPage } from "@/components/creative/context";
import { PipelineRail } from "@/components/creative/graphics";
import { NewProjectForm } from "@/components/creative/client";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listProjects } from "@/server/modules/creative/pipeline";
import { campaignUsage, studioOverview } from "@/server/modules/creative/library";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { formatMicros, IMAGE_STATUS_PROVIDERS, RENDER_PROVIDERS, SCENE_VIDEO_PROVIDERS, VOICE_PROVIDERS } from "@/server/modules/creative/presets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("creative.title") };
}

const STATUS_TONE = { DRAFT: "neutral", IN_PROGRESS: "accent", IN_REVIEW: "warning", APPROVED: "success", EXPORTED: "success", ARCHIVED: "neutral" } as const;

export default async function StudioOverviewPage() {
  const p = await studioPage("overview");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const [projects, overview, usage, campaigns] = await Promise.all([
    listProjects(viewer.ctx, org.id, company.id),
    studioOverview(viewer.ctx, org.id, company.id),
    campaignUsage(viewer.ctx, org.id, company.id),
    campaignOptions(viewer.ctx, org.id, company.id),
  ]);
  const has = (keys: readonly string[]) => keys.some((k) => overview.connected.includes(k));
  const capabilities = [
    { key: "text", ok: has(["openai", "gemini"]), href: "openai" },
    { key: "image", ok: has(IMAGE_STATUS_PROVIDERS), href: "openai" },
    { key: "video", ok: has(SCENE_VIDEO_PROVIDERS), href: "runway" },
    { key: "voice", ok: has(VOICE_PROVIDERS), href: "elevenlabs" },
    { key: "music", ok: has(["jamendo"]), href: "jamendo" },
    { key: "render", ok: has(RENDER_PROVIDERS), href: "shotstack" },
  ];
  const meter = (m: { used: number; limit: number | null }) => (m.limit === null ? `${m.used}` : `${m.used} / ${m.limit}`);
  const videos = projects.filter((x) => x.kind === "VIDEO");
  return wrap(
    <>
      <AutoRefresh active={projects.some((x) => x.running)} intervalMs={8000} />
      <StatGrid>
        <StatTile index={0} icon={<Wallet />} label={t("creative.overview.spend")} value={formatMicros(overview.spendMicros)} hint={t("creative.overview.spendHint", { days: overview.days })} />
        <StatTile index={1} icon={<ImageIcon />} label={t("creative.overview.images")} value={meter(overview.meters.image)} hint={t("creative.overview.thisMonth")} href={`/${locale}/studio/images`} />
        <StatTile index={2} icon={<Clapperboard />} label={t("creative.overview.videos")} value={meter(overview.meters.video)} hint={t("creative.overview.thisMonth")} />
        <StatTile index={3} icon={<Library />} label={t("creative.overview.library")} value={Object.values(overview.counts).reduce((a, b) => a + (b ?? 0), 0)} href={`/${locale}/studio/library`} />
      </StatGrid>

      <Card>
        <CardHeader title={t("creative.overview.setupTitle")} description={t("creative.overview.setupHint")} />
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((c) => (
              <li key={c.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                {c.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span className="grid gap-0.5">
                  <span className="font-medium">{t(`creative.capabilities.${c.key}.title`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`creative.capabilities.${c.key}.${c.ok ? "ready" : "missing"}`)}</span>
                  {!c.ok && perms.integrations ? (
                    <Link href={`/${locale}/integrations/${c.href}`} className="text-xs font-medium text-primary hover:underline">
                      {t("creative.common.connect")}
                    </Link>
                  ) : null}
                </span>
                <span className="sr-only">{c.ok ? t("creative.common.ready") : t("creative.common.notReady")}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            icon={<Clapperboard />}
            title={t("creative.projects.title")}
            description={t("creative.projects.description")}
            actions={perms.manage ? <NewProjectForm base={base} locale={locale} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} connected={overview.connected} /> : undefined}
          />
          <CardBody>
            {videos.length ? (
              <ul className="grid gap-3">
                {videos.map((v) => (
                  <li key={v.id}>
                    <Link href={`/${locale}/studio/projects/${v.id}`} className="grid gap-2 rounded-lg border p-3 transition-colors hover:border-border-strong hover:bg-muted/30">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{v.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {v.attention ? <Badge tone="warning">{t("creative.projects.attention", { count: v.attention })}</Badge> : null}
                          {v.running ? <Badge tone="info" pulse>{t("creative.projects.working")}</Badge> : null}
                          <Badge tone={STATUS_TONE[v.status]}>{t(`creative.status.${v.status}`)}</Badge>
                        </span>
                      </div>
                      <PipelineRail label={t("creative.projects.progress", { done: v.done, total: v.total })} steps={v.rail} />
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {v.aspect} · {v.targetSeconds}s
                        </span>
                        <span>{v.current ? t("creative.projects.next", { step: t(`creative.steps.names.${v.current}`) }) : t("creative.projects.complete")}</span>
                        <span>{t("creative.projects.cost", { cost: formatMicros(v.costMicros) })}</span>
                        <span>{formatDateTime(v.updatedAt, locale, tz)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>{perms.manage ? t("creative.projects.empty") : t("creative.projects.emptyReadOnly")}</EmptyState>
            )}
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Wallet />} title={t("creative.costs.title")} description={t("creative.costs.description")} />
            <CardBody className="grid gap-3 text-sm">
              {overview.byProvider.length ? (
                <ul className="grid gap-1.5">
                  {overview.byProvider.map((r) => (
                    <li key={r.provider} className="flex justify-between gap-2">
                      <span>
                        {t(`creative.providers.${r.provider}`)} <span className="text-xs text-muted-foreground">· {t("creative.costs.assets", { count: r.count })}</span>
                      </span>
                      <span className="tabular-nums">{formatMicros(r.costMicros)}</span>
                    </li>
                  ))}
                  {overview.byStep.map((r) => (
                    <li key={r.step} className="flex justify-between gap-2 text-muted-foreground">
                      <span>{t(`creative.steps.names.${r.step}`)}</span>
                      <span className="tabular-nums">{formatMicros(r.costMicros)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("creative.costs.empty")}</p>
              )}
              <div className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
                <span>{t("creative.costs.meterImages", { value: meter(overview.meters.image) })}</span>
                <span>{t("creative.costs.meterVideos", { value: meter(overview.meters.video) })}</span>
                <span>{t("creative.costs.meterContent", { value: meter(overview.meters.content) })}</span>
                <span>{t("creative.costs.estimates")}</span>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("creative.usage.title")} description={t("creative.usage.description")} />
            <CardBody>
              {usage.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {usage.map((u) => (
                    <li key={u.campaignId} className="flex flex-wrap justify-between gap-2">
                      <Link href={`/${locale}/studio/library?campaignId=${u.campaignId}`} className="hover:underline">
                        {u.name}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">{t("creative.usage.row", { assets: u.assets, posts: u.posts, cost: formatMicros(u.costMicros) })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("creative.usage.empty")}</p>
              )}
            </CardBody>
          </Card>
          {!perms.manage ? <Notice tone="info">{t("creative.common.readOnly")}</Notice> : null}
        </div>
      </div>
    </>,
  );
}
