import type { Metadata } from "next";
import Link from "next/link";
import { ImageIcon, Palette } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Badge } from "@/components/ui/badge";
import { MarketingShell, Pager, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip, SmartEmpty } from "@/components/marketing/studio";
import { AssetActions, CreativeGenerator, UploadForm, UseInPost, VideoForm } from "@/components/marketing/studio-forms";
import { Pop } from "@/components/marketing/studio-client";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { ASSET_KINDS, assetOptions, creativeStatus, listAssets, parseAssetFilters, PRESETS } from "@/server/modules/marketing/assets";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { listAccounts } from "@/server/modules/marketing/social";
import { loadBrandKit } from "@/server/modules/marketing/brand";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.studio") };
}

export default async function CreativeStudioPage({ searchParams }: PageProps<"/[locale]/marketing/studio">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "studio" as const, title: t("marketing.studio.creative.title"), subtitle: t("marketing.studio.creative.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseAssetFilters(await searchParams);
  const [assets, status, campaigns, images, { accounts }, kit, help] = await Promise.all([
    listAssets(viewer.ctx, org.id, company.id, f),
    creativeStatus(org.id, company.id),
    campaignOptions(viewer.ctx, org.id, company.id),
    assetOptions(viewer.ctx, org.id, company.id, ["IMAGE", "LOGO"]),
    listAccounts(viewer.ctx, org.id, company.id),
    loadBrandKit(db(), company.id),
    listHelpTasks(org.id, company.id, "studio"),
  ]);
  const path = `/${locale}/marketing/studio`;
  const filtered = !!(f.q || f.kind || f.campaignId);
  return (
    <MarketingShell {...shell}>
      <AutoRefresh active={assets.data.some((a) => a.status === "PROCESSING")} intervalMs={10000} />
      <InfoStrip t={t} k="studio" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card variant="highlight" className="lg:col-span-2">
          <CardHeader title={t("marketing.studio.creative.generateTitle")} description={t("marketing.studio.creative.generateHint")} />
          <div className="grid gap-3 p-4">
            {!status.image ? (
              <Notice tone="info">
                {t("marketing.studio.creative.connectImages")}{" "}
                <Link className="underline" href={`/${locale}/integrations/openai`}>
                  OpenAI
                </Link>{" "}
                ·{" "}
                <Link className="underline" href={`/${locale}/integrations/stability`}>
                  Stability
                </Link>
              </Notice>
            ) : null}
            {canManage ? <CreativeGenerator base={base} campaigns={campaigns} connected={status.image} /> : <p className="text-sm text-muted-foreground">{t("errors.forbidden")}</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("marketing.studio.creative.brandAssets")} actions={<Link href={`/${locale}/marketing/brand`} className="text-xs hover:underline">{t("marketing.tabs.brand")}</Link>} />
          <div className="grid gap-3 p-4 text-sm">
            {kit ? (
              <>
                {kit.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- brand logo URL
                  <img src={kit.logoUrl} alt={kit.brandName} className="max-h-12 w-auto object-contain" />
                ) : (
                  <p className="font-semibold">{kit.brandName}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {kit.colors.map((c) => (
                    <span key={c.hex} className="flex items-center gap-1 text-xs">
                      <span className="size-5 rounded-full border" style={{ background: c.hex }} aria-hidden />
                      {c.name} {c.hex}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kit.headingFont ?? "—"} / {kit.bodyFont ?? "—"}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Palette className="size-4" aria-hidden />
                {t("marketing.studio.creative.noBrand")}
              </p>
            )}
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-medium">{t("marketing.studio.creative.presetsTitle")}</p>
              <ul className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                {Object.entries(PRESETS).map(([k, v]) => (
                  <li key={k}>
                    {t(`marketing.studio.creative.presets.${k}`)}: {v.width}×{v.height}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("marketing.studio.creative.videoTitle")} description={t("marketing.studio.creative.videoHint")} />
            <div className="p-4">
              <VideoForm base={base} images={images} connected={status.video} campaigns={campaigns} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t("marketing.studio.creative.uploadTitle")} />
            <div className="p-4">
              <UploadForm base={base} />
            </div>
          </Card>
        </div>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.studio.creative.library")} description={t("marketing.common.count", { count: assets.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.studio.creative.search")} />
          <Select name="kind" defaultValue={f.kind ?? ""} aria-label={t("marketing.studio.creative.kind")}>
            <option value="">{t("marketing.studio.creative.allKinds")}</option>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`marketing.studio.creative.kinds.${k}`)}
              </option>
            ))}
          </Select>
          <Select name="campaign" defaultValue={f.campaignId ?? ""} aria-label={t("marketing.campaigns.campaign")}>
            <option value="">{t("marketing.campaigns.allCampaigns")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("marketing.common.apply")}
          </Button>
        </form>
        <div className="p-3">
          {assets.data.length === 0 ? (
            <SmartEmpty icon={<ImageIcon />} title={filtered ? t("common.noResults") : t("marketing.studio.creative.emptyTitle")} body={t("marketing.studio.creative.emptyBody")} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {assets.data.map((a, i) => {
                const ov = a.overlay as { headline?: string; position?: string } | null;
                return (
                  <Pop key={a.id} i={i}>
                    <Card className="grid h-full content-start gap-2 overflow-hidden">
                      <div className="relative grid aspect-square place-items-center overflow-hidden bg-muted">
                        {a.status === "PROCESSING" ? (
                          <span className="shimmer absolute inset-0" aria-hidden />
                        ) : a.status === "FAILED" ? (
                          <p className="p-4 text-center text-xs text-danger">{a.error ?? t("marketing.studio.creative.failed")}</p>
                        ) : a.kind === "VIDEO" && a.publicUrl ? (
                          <video src={a.previewUrl ?? a.publicUrl} className="size-full object-cover" muted playsInline controls preload="metadata" />
                        ) : a.publicUrl && (a.mimeType?.startsWith("image/") ?? true) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed asset URL
                          <img src={a.previewUrl ?? a.publicUrl} alt={a.name} className="size-full object-cover" loading="lazy" />
                        ) : (
                          <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
                        )}
                        {ov?.headline && a.status === "READY" ? (
                          <span className={`pointer-events-none absolute inset-x-3 rounded-md bg-black/45 p-2 text-center text-sm font-semibold text-white ${ov.position === "bottom" ? "bottom-3" : ov.position === "center" ? "top-1/2 -translate-y-1/2" : "top-3"}`}>{ov.headline}</span>
                        ) : null}
                      </div>
                      <div className="grid gap-1.5 px-3 pb-3 text-xs">
                        <p className="truncate font-medium" title={a.name}>
                          {a.name}
                        </p>
                        <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
                          <Badge>{t(`marketing.studio.creative.kinds.${a.kind}`)}</Badge>
                          {a.status === "PROCESSING" ? <Badge tone="info" pulse>{t("marketing.studio.creative.processing")}</Badge> : null}
                          {a.provider ? <Badge tone="brand">{a.provider}</Badge> : null}
                          {a.width ? `${a.width}×${a.height}` : null}
                          <span>{formatDateTime(a.createdAt, locale, tz)}</span>
                        </p>
                        {canManage ? <AssetActions base={base} asset={a} campaigns={campaigns} /> : null}
                        {canManage && a.status === "READY" && (a.kind === "IMAGE" || a.kind === "VIDEO") ? <UseInPost base={base} assetId={a.id} title={a.name} accounts={accounts.map((x) => ({ id: x.id, name: x.name, provider: x.provider }))} /> : null}
                      </div>
                    </Card>
                  </Pop>
                );
              })}
            </div>
          )}
        </div>
        <Pager path={path} params={{ q: f.q, kind: f.kind, campaign: f.campaignId }} page={f.page} total={assets.total} pageSize={assets.pageSize} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="studio" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
