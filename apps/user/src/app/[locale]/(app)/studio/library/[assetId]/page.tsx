import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, History, ScanSearch } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { studioPage } from "@/components/creative/context";
import { AssetEditForm, DeleteButton, ImageActions } from "@/components/creative/client";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { db } from "@/server/core/db";
import { getLibraryAsset } from "@/server/modules/creative/library";
import type { BrandCheck } from "@/server/modules/creative/library";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { formatMicros } from "@/server/modules/creative/presets";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("creative.asset.title") };
}

export default async function StudioAssetPage({ params }: PageProps<"/[locale]/studio/library/[assetId]">) {
  const { assetId } = await params;
  const p = await studioPage("asset");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  let detail: Awaited<ReturnType<typeof getLibraryAsset>>;
  try {
    detail = await getLibraryAsset(viewer.ctx, org.id, company.id, assetId);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  const { asset: a, versions, usage } = detail;
  const [campaigns, folders] = await Promise.all([campaignOptions(viewer.ctx, org.id, company.id), db().creativeFolder.findMany({ where: { organizationId: org.id, companyId: company.id }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const check = a.brandCheck as BrandCheck | null;
  const lic = a.license as { source?: string; note?: string; licenseUrl?: string; attribution?: string } | null;
  return wrap(
    <>
      <Link href={`/${locale}/studio/library`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("creative.asset.back")}
      </Link>
      {a.archivedAt ? <Notice tone="warning">{t("creative.asset.archived")}</Notice> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title={a.name}
            description={[t(`creative.kinds.${a.kind}`), a.role ? t(`creative.roles.${a.role}`) : a.category ? t(`creative.categories.${a.category}`) : null, `v${a.version}`].filter(Boolean).join(" · ")}
            actions={
              <a href={`${base}/creative/library/${a.id}/download`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                <Download aria-hidden className="size-4" />
                {t("creative.actions.download")}
              </a>
            }
          />
          <CardBody className="grid gap-4">
            <div className="grid place-items-center overflow-hidden rounded-lg bg-muted">
              {a.kind === "IMAGE" && a.file?.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                <img src={a.file.previewUrl} alt={a.name} className="max-h-[70vh] w-auto object-contain" />
              ) : a.kind === "VIDEO" && a.file?.previewUrl ? (
                <video src={a.file.previewUrl} controls playsInline className="max-h-[70vh] w-full" aria-label={a.name} />
              ) : a.kind === "AUDIO" && a.file?.previewUrl ? (
                <audio src={a.file.previewUrl} controls className="m-6 w-full max-w-md" aria-label={a.name} />
              ) : (
                <p className="p-10 text-sm text-muted-foreground">{t("creative.library.noPreview")}</p>
              )}
            </div>
            {a.kind === "IMAGE" ? <ImageActions base={base} assetId={a.id} canManage={perms.manage && !a.archivedAt} /> : null}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {a.prompt ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t("creative.asset.prompt")}</dt>
                  <dd className="whitespace-pre-wrap">{a.prompt}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground">{t("creative.asset.provider")}</dt>
                <dd>{a.provider ? `${t(`creative.providers.${a.provider}`)}${a.model ? ` · ${a.model}` : ""}` : t("creative.asset.uploaded")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("creative.asset.cost")}</dt>
                <dd>{formatMicros(a.costMicros)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("creative.asset.created")}</dt>
                <dd>{formatDateTime(a.createdAt, locale, tz)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("creative.asset.usage")}</dt>
                <dd>{t("creative.asset.posts", { count: usage.posts })}</dd>
              </div>
              {a.projectId ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t("creative.asset.project")}</dt>
                  <dd>
                    <Link href={`/${locale}/studio/projects/${a.projectId}`} className="text-primary hover:underline">
                      {t("creative.asset.openProject")}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {lic ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t("creative.asset.license")}</dt>
                  <dd>
                    {lic.attribution ?? lic.note ?? lic.source}
                    {lic.licenseUrl ? (
                      <>
                        {" "}
                        <a href={lic.licenseUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                          {t("creative.music.license")}
                        </a>
                      </>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          {a.kind === "IMAGE" ? (
            <Card>
              <CardHeader icon={<ScanSearch />} title={t("creative.brand.checkTitle")} description={t("creative.brand.checkHint")} />
              <CardBody className="grid gap-3 text-sm">
                {check ? (
                  <>
                    <div className="flex items-center gap-2">
                      {check.score !== null ? <Badge tone={check.score >= 75 ? "success" : check.score >= 50 ? "warning" : "danger"}>{t("creative.brand.score", { score: check.score })}</Badge> : <Badge>{t("creative.brand.noScore")}</Badge>}
                      <span className="text-xs text-muted-foreground">{formatDateTime(check.checkedAt, locale, tz)}</span>
                    </div>
                    {check.palette ? (
                      <div className="grid gap-2">
                        <p>{t("creative.brand.coverage", { percent: Math.round(check.palette.brandCoverage * 100) })}</p>
                        <div className="flex flex-wrap gap-1.5" aria-label={t("creative.brand.dominant")}>
                          {check.palette.dominant.map((d) => (
                            <span key={d.hex} className="flex items-center gap-1 text-[11px]">
                              <span className="size-4 rounded border" style={{ background: d.hex }} aria-hidden />
                              {d.hex} · {Math.round(d.share * 100)}%
                            </span>
                          ))}
                        </div>
                        {check.palette.offPalette.length ? <p className="text-xs text-warning">{t("creative.brand.offPalette", { colors: check.palette.offPalette.join(", ") })}</p> : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t(`creative.brand.paletteNote.${check.paletteNote ?? "format_not_supported"}`)}</p>
                    )}
                    {check.logo.checked ? (
                      <ul className="grid gap-1 text-xs">
                        <li>{check.logo.logoVisible ? (check.logo.matchesReference === false ? t("creative.brand.logoWrong") : t("creative.brand.logoOk")) : t("creative.brand.logoAbsent")}</li>
                        {check.logo.textIssues?.map((x) => (
                          <li key={x} className="text-warning">
                            {t("creative.brand.textIssue", { issue: x })}
                          </li>
                        ))}
                        {check.logo.offBrand?.map((x) => (
                          <li key={x} className="text-warning">
                            {t("creative.brand.offBrand", { issue: x })}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t(`creative.brand.logoNote.${check.logo.reason ?? "no_logo"}`)}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("creative.brand.notChecked")}</p>
                )}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader icon={<History />} title={t("creative.asset.versions")} />
            <CardBody>
              <ol className="grid gap-2">
                {versions.map((v) => (
                  <li key={v.id}>
                    <Link href={`/${locale}/studio/library/${v.id}`} aria-current={v.id === a.id ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md border p-2 text-sm", v.id === a.id ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                      <span className="size-12 shrink-0 overflow-hidden rounded bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                        {v.kind === "IMAGE" && v.file?.previewUrl ? <img src={v.file.previewUrl} alt="" className="size-full object-cover" loading="lazy" /> : null}
                      </span>
                      <span className="grid min-w-0">
                        <span className="font-medium">
                          v{v.version} · {t(`creative.operations.${v.operation}`)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {formatDateTime(v.createdAt, locale, tz)} · {formatMicros(v.costMicros)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
          {perms.manage && !a.archivedAt ? (
            <Card>
              <CardHeader title={t("creative.asset.details")} />
              <CardBody className="grid gap-3">
                <AssetEditForm base={base} asset={{ id: a.id, name: a.name, tags: a.tags, folderId: a.folderId, campaignId: a.campaignId, category: a.category }} folders={folders} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} />
                <div className="border-t pt-3">
                  <DeleteButton path={`${base}/creative/library/${a.id}`} label={t("creative.asset.archive")} confirm={t("creative.asset.archiveConfirm")} after={`/${locale}/studio/library`} />
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>,
  );
}
