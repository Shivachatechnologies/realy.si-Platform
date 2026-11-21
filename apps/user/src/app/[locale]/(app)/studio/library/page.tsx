import type { Metadata } from "next";
import Link from "next/link";
import { AudioLines, Captions, FileJson, Film, Folder, ImageIcon, Search } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, Pager, hrefWith } from "@/components/comms/bits";
import { studioPage } from "@/components/creative/context";
import { DeleteButton, FolderForm, UploadForm } from "@/components/creative/client";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { ASSET_KINDS, listLibrary, parseLibraryFilters } from "@/server/modules/creative/library";
import { formatMicros, IMAGE_CATEGORIES } from "@/server/modules/creative/presets";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("creative.tabs.library") };
}

const KIND_ICON = { IMAGE: ImageIcon, VIDEO: Film, AUDIO: AudioLines, CAPTIONS: Captions, TIMELINE: FileJson, DOCUMENT: FileJson } as const;

export default async function StudioLibraryPage({ searchParams }: PageProps<"/[locale]/studio/library">) {
  const p = await studioPage("library");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const raw = await searchParams;
  const f = parseLibraryFilters(raw);
  const lib = await listLibrary(viewer.ctx, org.id, company.id, f);
  const path = `/${locale}/studio/library`;
  const current = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const pages = Math.max(1, Math.ceil(lib.total / lib.pageSize));
  const filtered = !!(f.q || f.kind || f.folderId || f.category || f.campaignId || f.tag || f.projectId);
  return wrap(
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-4">
        <Card>
          <CardHeader icon={<Folder />} title={t("creative.library.folders")} />
          <CardBody className="grid gap-2">
            <nav aria-label={t("creative.library.folders")} className="grid gap-0.5 text-sm">
              <Link href={hrefWith(path, current, { folderId: null, page: null })} aria-current={!f.folderId ? "page" : undefined} className={cn("rounded-md px-2 py-1.5", !f.folderId ? "bg-muted font-medium" : "hover:bg-muted/60")}>
                {t("creative.library.all")} <span className="text-xs text-muted-foreground">· {lib.total}</span>
              </Link>
              {lib.folders.map((fo) => (
                <span key={fo.id} className="flex items-center justify-between gap-1">
                  <Link href={hrefWith(path, current, { folderId: fo.id, page: null })} aria-current={f.folderId === fo.id ? "page" : undefined} className={cn("flex-1 truncate rounded-md px-2 py-1.5", f.folderId === fo.id ? "bg-muted font-medium" : "hover:bg-muted/60")}>
                    {fo.name} <span className="text-xs text-muted-foreground">· {fo.count}</span>
                  </Link>
                  {perms.manage && f.folderId === fo.id ? <DeleteButton path={`${base}/creative/folders/${fo.id}`} label={t("creative.common.delete")} confirm={t("creative.library.deleteFolderConfirm")} after={path} /> : null}
                </span>
              ))}
            </nav>
            {perms.manage ? <FolderForm base={base} /> : null}
          </CardBody>
        </Card>
        {perms.manage ? (
          <Card>
            <CardHeader title={t("creative.library.uploadTitle")} description={t("creative.library.uploadHint")} />
            <CardBody>
              <UploadForm base={base} folders={lib.folders.map((x) => ({ id: x.id, name: x.name }))} />
            </CardBody>
          </Card>
        ) : null}
      </aside>
      <Card>
        <CardHeader title={t("creative.library.title")} description={t("creative.library.description")} />
        <CardBody className="grid gap-4">
          <form method="get" action={path} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" role="search">
            {f.folderId ? <input type="hidden" name="folderId" value={f.folderId} /> : null}
            {f.campaignId ? <input type="hidden" name="campaignId" value={f.campaignId} /> : null}
            <Input name="q" defaultValue={f.q ?? ""} placeholder={t("creative.library.search")} aria-label={t("creative.library.search")} />
            <Select name="kind" defaultValue={f.kind ?? ""} aria-label={t("creative.library.kind")}>
              <option value="">{t("creative.library.allKinds")}</option>
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`creative.kinds.${k}`)}
                </option>
              ))}
            </Select>
            <Select name="category" defaultValue={f.category ?? ""} aria-label={t("creative.images.category")}>
              <option value="">{t("creative.library.allCategories")}</option>
              {IMAGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`creative.categories.${c}`)}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              <Search aria-hidden />
              {t("creative.library.filter")}
            </Button>
          </form>
          {lib.data.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {lib.data.map((a) => {
                const Icon = KIND_ICON[a.kind];
                const isVideo = a.kind === "VIDEO";
                return (
                  <li key={a.id}>
                    <Link href={`${path}/${a.id}`} className="grid gap-2 rounded-lg border bg-surface p-2 transition-colors hover:border-border-strong">
                      <span className="relative block aspect-video overflow-hidden rounded-md bg-muted">
                        {a.kind === "IMAGE" && a.file?.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                          <img src={a.file.previewUrl} alt={a.name} loading="lazy" className="size-full object-cover" />
                        ) : isVideo && a.file?.previewUrl ? (
                          <video src={a.file.previewUrl} muted playsInline preload="metadata" className="size-full object-cover" aria-label={a.name} />
                        ) : (
                          <span className="grid size-full place-items-center text-muted-foreground">
                            <Icon aria-hidden className="size-8" />
                          </span>
                        )}
                        <span className="absolute start-2 top-2 flex gap-1">
                          <Badge>{t(`creative.kinds.${a.kind}`)}</Badge>
                          {a.version > 1 ? <Badge tone="info">v{a.version}</Badge> : null}
                        </span>
                      </span>
                      <span className="truncate text-sm font-medium">{a.name}</span>
                      <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        {a.role ? <span>{t(`creative.roles.${a.role}`)}</span> : a.category ? <span>{t(`creative.categories.${a.category}`)}</span> : null}
                        <span>{formatDate(a.createdAt, locale, tz)}</span>
                        {a.costMicros !== null ? <span>{formatMicros(a.costMicros)}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>{filtered ? t("creative.library.noMatches") : t("creative.library.empty")}</EmptyState>
          )}
          {pages > 1 ? (
            <Pager
              prevHref={f.page > 1 ? hrefWith(path, current, { page: String(f.page - 1) }) : null}
              nextHref={f.page < pages ? hrefWith(path, current, { page: String(f.page + 1) }) : null}
              labels={{ prev: t("creative.common.prev"), next: t("creative.common.next") }}
              info={t("creative.common.page", { page: f.page, pages })}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>,
  );
}
