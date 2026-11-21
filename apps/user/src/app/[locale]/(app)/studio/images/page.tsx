import type { Metadata } from "next";
import Link from "next/link";
import { ImageIcon, LayoutTemplate, Palette, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/comms/bits";
import { studioPage } from "@/components/creative/context";
import { ImageActions, ImageGenerator, TemplateForm, UseTemplateButton } from "@/components/creative/client";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { listLibrary, listTemplates, studioOverview } from "@/server/modules/creative/library";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { loadBrandKit } from "@/server/modules/marketing/brand";
import { formatMicros, IMAGE_STATUS_PROVIDERS } from "@/server/modules/creative/presets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("creative.tabs.images") };
}

const scoreTone = (s: number) => (s >= 75 ? "success" : s >= 50 ? "warning" : "danger");

export default async function StudioImagesPage() {
  const p = await studioPage("images");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, base, perms, wrap } = p;
  const [recent, overview, campaigns, kit, templates] = await Promise.all([
    listLibrary(viewer.ctx, org.id, company.id, { kind: "IMAGE", page: 1 }),
    studioOverview(viewer.ctx, org.id, company.id),
    campaignOptions(viewer.ctx, org.id, company.id),
    loadBrandKit(db(), company.id),
    listTemplates(viewer.ctx, org.id, company.id),
  ]);
  const connected = IMAGE_STATUS_PROVIDERS.some((k) => overview.connected.includes(k));
  const imageTemplates = templates.filter((x) => x.kind === "IMAGE_SET");
  return wrap(
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card variant="highlight">
          <CardHeader icon={<Sparkles />} title={t("creative.images.title")} description={t("creative.images.description")} />
          <CardBody className="grid gap-3">
            {!connected ? (
              <Notice tone="info" action={perms.integrations ? <Link href={`/${locale}/integrations/openai`} className="text-sm font-medium text-primary hover:underline">{t("creative.common.connect")}</Link> : undefined}>
                {t("creative.images.notConnected")}
              </Notice>
            ) : null}
            {perms.manage ? (
              <ImageGenerator base={base} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} folders={recent.folders.map((f) => ({ id: f.id, name: f.name }))} connected={connected} brandReady={!!kit} />
            ) : (
              <Notice tone="info">{t("creative.common.readOnly")}</Notice>
            )}
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Palette />} title={t("creative.brand.title")} actions={<Link href={`/${locale}/marketing/brand`} className="text-xs text-primary hover:underline">{t("creative.brand.edit")}</Link>} />
            <CardBody className="grid gap-2 text-sm">
              {kit ? (
                <>
                  <p className="font-medium">{kit.brandName}</p>
                  <div className="flex flex-wrap gap-2">
                    {kit.colors.map((c) => (
                      <span key={c.hex} className="flex items-center gap-1 text-xs">
                        <span className="size-4 rounded-full border" style={{ background: c.hex }} aria-hidden />
                        {c.name}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("creative.brand.fonts", { heading: kit.headingFont ?? "—", body: kit.bodyFont ?? "—" })}</p>
                  {kit.voiceTone ? <p className="line-clamp-3 text-xs text-muted-foreground">{kit.voiceTone}</p> : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("creative.brand.missing")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<LayoutTemplate />} title={t("creative.templates.title")} description={t("creative.templates.description")} />
            <CardBody className="grid gap-3">
              {imageTemplates.length ? (
                <ul className="grid gap-2">
                  {imageTemplates.map((tpl) => (
                    <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{tpl.name}</span> <span className="text-xs text-muted-foreground">· {t(`creative.categories.${tpl.category}`)}</span>
                      </span>
                      {perms.manage ? <UseTemplateButton base={base} template={tpl} disabled={!connected} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("creative.templates.empty")}</p>
              )}
              {perms.manage ? (
                <details className="rounded-md border p-2">
                  <summary className="cursor-pointer text-sm font-medium">{t("creative.templates.new")}</summary>
                  <div className="pt-3">
                    <TemplateForm base={base} />
                  </div>
                </details>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader icon={<ImageIcon />} title={t("creative.images.recent")} actions={<Link href={`/${locale}/studio/library?kind=IMAGE`} className="text-sm font-medium text-primary hover:underline">{t("creative.images.allInLibrary")}</Link>} />
        <CardBody>
          {recent.data.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {recent.data.slice(0, 24).map((a) => {
                const score = a.brandCheck && typeof (a.brandCheck as { score?: unknown }).score === "number" ? (a.brandCheck as { score: number }).score : null;
                return (
                  <li key={a.id} className="grid content-start gap-2 rounded-lg border bg-surface p-2">
                    <Link href={`/${locale}/studio/library/${a.id}`} className="relative block aspect-square overflow-hidden rounded-md bg-muted">
                      {a.file?.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                        <img src={a.file.previewUrl} alt={a.name} loading="lazy" className="size-full object-cover transition-transform duration-300 hover:scale-[1.02] motion-reduce:transition-none" />
                      ) : (
                        <span className="grid size-full place-items-center text-xs text-muted-foreground">{t("creative.library.noPreview")}</span>
                      )}
                      <span className="absolute start-2 top-2 flex gap-1">
                        <Badge>v{a.version}</Badge>
                        {score !== null ? <Badge tone={scoreTone(score)}>{t("creative.brand.score", { score })}</Badge> : null}
                      </span>
                    </Link>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="text-muted-foreground">
                        {a.category ? t(`creative.categories.${a.category}`) : ""} {a.costMicros !== null ? `· ${formatMicros(a.costMicros)}` : ""}
                      </span>
                    </div>
                    <ImageActions base={base} assetId={a.id} canManage={perms.manage} compact />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>{t("creative.images.empty")}</EmptyState>
          )}
        </CardBody>
      </Card>
    </>,
  );
}

