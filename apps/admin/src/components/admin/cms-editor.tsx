"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Copy, Eye, History, Plus, Rocket, Save, Trash2, Undo2 } from "lucide-react";
import type { CmsBlock, CmsBlockType, CmsContent, CmsLocale, CmsVariant } from "@/server/modules/cms/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ActionDialog } from "./action-dialog";
import { CmsPreview } from "./cms-preview";

const LOCALES: CmsLocale[] = ["en-US", "de-DE", "ar-AE", "hi-IN", "zh-CN"];
const BLOCK_TYPES: CmsBlockType[] = ["hero", "features", "richText", "image", "cta", "faq", "pricing"];

export interface CmsEntryDTO {
  id: string;
  kind: "PAGE" | "POST" | "LANDING";
  slug: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  draft: CmsContent;
  hasPublished: boolean;
  publishAt: string | null;
  publishedAt: string | null;
  liveVersion: number | null;
  updatedAt: string;
  updatedBy: string;
  versions: { id: string; version: number; note: string; createdBy: string; createdAt: string }[];
}

export interface MediaOption {
  ref: string;
  fileName: string;
  url: string | null;
}

const newId = () => Math.random().toString(36).slice(2, 12).padEnd(8, "0");
const emptyVariant = (): CmsVariant => ({ title: "", summary: "", seoTitle: "", seoDescription: "", ogImage: "", noIndex: false, blocks: [] });

function newBlock(type: CmsBlockType): CmsBlock {
  const id = newId();
  switch (type) {
    case "hero":
      return { id, type, eyebrow: "", title: "", subtitle: "", ctaLabel: "", ctaHref: "", image: "" };
    case "features":
      return { id, type, title: "", items: [{ title: "", body: "" }] };
    case "richText":
      return { id, type, body: "" };
    case "image":
      return { id, type, image: "", alt: "", caption: "" };
    case "cta":
      return { id, type, title: "", body: "", ctaLabel: "", ctaHref: "" };
    case "faq":
      return { id, type, title: "", items: [{ q: "", a: "" }] };
    case "pricing":
      return { id, type, title: "", subtitle: "" };
  }
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cn("text-[11px] tabular-nums", value.length > max ? "text-danger" : "text-muted-foreground")}>{`${value.length}/${max}`}</span>;
}

/** Image field: pick from the media library or paste an https URL. */
function ImageField({ id, label, value, onChange, media }: { id: string; label: string; value: string; onChange: (v: string) => void; media: MediaOption[] }) {
  const { t } = useI18n();
  const fromLibrary = value.startsWith("media:");
  return (
    <Field label={label} htmlFor={id}>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <Select aria-label={t("admin.cms.mediaLibrary")} value={fromLibrary ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("admin.cms.noMedia")}</option>
          {media.map((m) => (
            <option key={m.ref} value={m.ref}>
              {m.fileName}
            </option>
          ))}
        </Select>
        <Input id={id} value={fromLibrary ? "" : value} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function BlockForm({ block, onChange, media }: { block: CmsBlock; onChange: (b: CmsBlock) => void; media: MediaOption[] }) {
  const { t } = useI18n();
  const f = (k: string) => `${block.id}-${k}`;
  const text = (key: string, label: string, max: number, area = false) => {
    const value = String((block as Record<string, unknown>)[key] ?? "");
    const set = (v: string) => onChange({ ...block, [key]: v } as CmsBlock);
    return (
      <Field label={<span className="flex justify-between gap-2">{label}<Counter value={value} max={max} /></span>} htmlFor={f(key)}>
        {area ? <Textarea id={f(key)} rows={key === "body" && block.type === "richText" ? 10 : 3} value={value} onChange={(e) => set(e.target.value)} /> : <Input id={f(key)} value={value} onChange={(e) => set(e.target.value)} />}
      </Field>
    );
  };
  switch (block.type) {
    case "hero":
      return (
        <div className="grid gap-2">
          {text("eyebrow", t("admin.cms.fields.eyebrow"), 80)}
          {text("title", t("admin.cms.fields.title"), 160)}
          {text("subtitle", t("admin.cms.fields.subtitle"), 400, true)}
          <div className="grid gap-2 sm:grid-cols-2">
            {text("ctaLabel", t("admin.cms.fields.ctaLabel"), 60)}
            {text("ctaHref", t("admin.cms.fields.ctaHref"), 500)}
          </div>
          <ImageField id={f("image")} label={t("admin.cms.fields.image")} value={block.image} media={media} onChange={(v) => onChange({ ...block, image: v })} />
        </div>
      );
    case "richText":
      return (
        <div className="grid gap-1">
          {text("body", t("admin.cms.fields.body"), 20000, true)}
          <p className="text-[11px] text-muted-foreground">{t("admin.cms.syntaxHint")}</p>
        </div>
      );
    case "image":
      return (
        <div className="grid gap-2">
          <ImageField id={f("image")} label={t("admin.cms.fields.image")} value={block.image} media={media} onChange={(v) => onChange({ ...block, image: v })} />
          {text("alt", t("admin.cms.fields.alt"), 200)}
          {text("caption", t("admin.cms.fields.caption"), 300)}
        </div>
      );
    case "cta":
      return (
        <div className="grid gap-2">
          {text("title", t("admin.cms.fields.title"), 160)}
          {text("body", t("admin.cms.fields.body"), 400, true)}
          <div className="grid gap-2 sm:grid-cols-2">
            {text("ctaLabel", t("admin.cms.fields.ctaLabel"), 60)}
            {text("ctaHref", t("admin.cms.fields.ctaHref"), 500)}
          </div>
        </div>
      );
    case "pricing":
      return (
        <div className="grid gap-2">
          {text("title", t("admin.cms.fields.title"), 160)}
          {text("subtitle", t("admin.cms.fields.subtitle"), 400)}
          <p className="text-[11px] text-muted-foreground">{t("admin.cms.pricingHint")}</p>
        </div>
      );
    case "features":
    case "faq": {
      const isFaq = block.type === "faq";
      const items = block.items as Record<string, string>[];
      const [a, b] = isFaq ? (["q", "a"] as const) : (["title", "body"] as const);
      const setItems = (next: Record<string, string>[]) => onChange({ ...block, items: next } as CmsBlock);
      return (
        <div className="grid gap-2">
          {text("title", t("admin.cms.fields.sectionTitle"), 160)}
          {items.map((it, i) => (
            <div key={i} className="grid gap-1.5 rounded-md border bg-surface-2 p-2">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                {isFaq ? t("admin.cms.question", { n: i + 1 }) : t("admin.cms.feature", { n: i + 1 })}
                <Button size="icon" variant="ghost" className="size-6" aria-label={t("admin.cms.removeItem")} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <Input aria-label={isFaq ? t("admin.cms.fields.question") : t("admin.cms.fields.title")} value={it[a] ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, [a]: e.target.value } : x)))} placeholder={isFaq ? t("admin.cms.fields.question") : t("admin.cms.fields.title")} />
              <Textarea aria-label={isFaq ? t("admin.cms.fields.answer") : t("admin.cms.fields.body")} rows={2} value={it[b] ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, [b]: e.target.value } : x)))} placeholder={isFaq ? t("admin.cms.fields.answer") : t("admin.cms.fields.body")} />
            </div>
          ))}
          <Button size="sm" variant="ghost" className="w-fit" onClick={() => setItems([...items, isFaq ? { q: "", a: "" } : { title: "", body: "" }])} disabled={items.length >= (isFaq ? 30 : 12)}>
            <Plus />
            {isFaq ? t("admin.cms.addQuestion") : t("admin.cms.addFeature")}
          </Button>
        </div>
      );
    }
  }
}

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} actions={actions} />
      <div className="grid gap-3 p-3">{children}</div>
    </Card>
  );
}

/** Structured block editor with locale variants, SEO, live preview, publish / schedule and version rollback. */
export function CmsEditor({ entry, media, canManage, publicBase }: { entry: CmsEntryDTO; media: MediaOption[]; canManage: boolean; publicBase: string | null }) {
  const { t, locale: uiLocale } = useI18n();
  const router = useRouter();
  const [content, setContent] = useState<CmsContent>(entry.draft);
  const [slug, setSlug] = useState(entry.slug);
  const [loc, setLoc] = useState<CmsLocale>("en-US");
  const [updatedAt, setUpdatedAt] = useState(entry.updatedAt);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishAt, setPublishAt] = useState("");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const variant = content.locales[loc];
  const mediaMap = useMemo(() => Object.fromEntries(media.filter((m) => m.url).map((m) => [m.ref, m.url!])), [media]);
  const readOnly = !canManage || entry.status === "ARCHIVED";

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (fn: (v: CmsVariant) => CmsVariant) => {
    setContent((c) => ({ locales: { ...c.locales, [loc]: fn(c.locales[loc] ?? emptyVariant()) } }));
    setDirty(true);
  };
  const setBlocks = (fn: (b: CmsBlock[]) => CmsBlock[]) => update((v) => ({ ...v, blocks: fn(v.blocks) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ updatedAt: string }>(`/api/v1/admin/cms/entries/${entry.id}`, { method: "PUT", body: { slug, content, expectedUpdatedAt: updatedAt } });
      setUpdatedAt(r.updatedAt);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString(uiLocale));
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: string, body: Record<string, unknown>) => {
    if (dirty && !(await save())) return;
    await api(`/api/v1/admin/cms/entries/${entry.id}/${action}`, { method: "POST", body });
    router.refresh();
  };

  const filled = (l: CmsLocale) => !!content.locales[l] && !!(content.locales[l]!.title || content.locales[l]!.blocks.length);
  const seo = variant ?? emptyVariant();
  const field = (key: "title" | "summary" | "seoTitle" | "seoDescription", label: string, max: number, area = false) => (
    <Field label={<span className="flex justify-between gap-2">{label}<Counter value={seo[key]} max={max} /></span>} htmlFor={`v-${key}`}>
      {area ? <Textarea id={`v-${key}`} rows={2} value={seo[key]} readOnly={readOnly} onChange={(e) => update((v) => ({ ...v, [key]: e.target.value }))} /> : <Input id={`v-${key}`} value={seo[key]} readOnly={readOnly} onChange={(e) => update((v) => ({ ...v, [key]: e.target.value }))} />}
    </Field>
  );

  return (
    <div className="grid gap-4">
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-surface/95 p-2 shadow-elev-2 backdrop-blur">
        <div role="tablist" aria-label={t("admin.cms.locales")} className="flex gap-1 overflow-x-auto">
          {LOCALES.map((l) => (
            <button
              key={l}
              role="tab"
              type="button"
              aria-selected={l === loc}
              onClick={() => setLoc(l)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] transition-colors focus-visible:outline-2", l === loc ? "border-primary/50 bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", filled(l) ? "bg-success" : "bg-border-strong")} />
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-1 lg:hidden">
          <Button size="sm" variant={view === "edit" ? "soft" : "ghost"} onClick={() => setView("edit")}>
            {t("admin.cms.edit")}
          </Button>
          <Button size="sm" variant={view === "preview" ? "soft" : "ghost"} onClick={() => setView("preview")}>
            <Eye />
            {t("admin.cms.preview")}
          </Button>
        </div>
        <span className="ms-auto text-[11px] text-muted-foreground">{dirty ? t("admin.cms.unsaved") : savedAt ? t("admin.cms.savedAt", { time: savedAt }) : null}</span>
        {!readOnly ? (
          <>
            <Button size="sm" variant="secondary" onClick={save} disabled={busy || !dirty} aria-busy={busy}>
              <Save />
              {t("admin.cms.saveDraft")}
            </Button>
            <ActionDialog
              trigger={
                <Button size="sm">
                  <Rocket />
                  {t("admin.cms.publish")}
                </Button>
              }
              title={t("admin.cms.publishTitle")}
              description={t("admin.cms.publishHint")}
              confirmLabel={t("admin.cms.publish")}
              onConfirm={(note) => act("publish", { note })}
            />
          </>
        ) : null}
      </div>
      <FormError error={error} />
      {entry.status === "ARCHIVED" ? <Notice tone="warning">{t("admin.cms.archivedNotice")}</Notice> : null}
      {entry.status === "SCHEDULED" && entry.publishAt ? <Notice tone="info">{t("admin.cms.scheduledNotice", { date: new Date(entry.publishAt).toLocaleString(uiLocale) })}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn("grid content-start gap-4", view === "preview" && "hidden lg:grid")}>
          {!filled(loc) && loc !== "en-US" && filled("en-US") && !readOnly ? (
            <Notice tone="info">
              <span className="flex flex-wrap items-center gap-2">
                {t("admin.cms.emptyLocale", { locale: loc })}
                <Button size="sm" variant="secondary" onClick={() => update(() => structuredClone(content.locales["en-US"]!))}>
                  <Copy />
                  {t("admin.cms.copyEnglish")}
                </Button>
              </span>
            </Notice>
          ) : null}
          <Panel title={t("admin.cms.pageSettings")}>
            {field("title", t("admin.cms.fields.pageTitle"), 200)}
            {field("summary", t("admin.cms.fields.summary"), 600, true)}
            <Field label={t("admin.cms.fields.slug")} htmlFor="v-slug" hint={publicBase ? `${publicBase}/${uiLocale}/pages/${slug}` : `/pages/${slug}`}>
              <Input id="v-slug" value={slug} readOnly={readOnly} className="font-mono" onChange={(e) => (setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")), setDirty(true))} />
            </Field>
          </Panel>
          <Panel title={t("admin.cms.seo")}>
            {field("seoTitle", t("admin.cms.fields.seoTitle"), 70)}
            {field("seoDescription", t("admin.cms.fields.seoDescription"), 170, true)}
            <ImageField id="v-og" label={t("admin.cms.fields.ogImage")} value={seo.ogImage} media={media} onChange={(v) => update((x) => ({ ...x, ogImage: v }))} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={seo.noIndex} disabled={readOnly} onChange={(e) => update((v) => ({ ...v, noIndex: e.target.checked }))} />
              {t("admin.cms.fields.noIndex")}
            </label>
            <div className="rounded-md border bg-surface-2 p-2.5">
              <div className="truncate text-sm text-primary">{seo.seoTitle || seo.title || "—"}</div>
              <div className="truncate font-mono text-[11px] text-success">{`…/pages/${slug}`}</div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{seo.seoDescription || seo.summary}</p>
            </div>
          </Panel>
          <Card>
            <CardHeader
              title={t("admin.cms.blocks")}
              description={t("admin.cms.blocksHint")}
              actions={
                !readOnly ? (
                  <Select
                    aria-label={t("admin.cms.addBlock")}
                    value=""
                    className="h-8 w-auto text-xs"
                    onChange={(e) => {
                      const type = e.target.value as CmsBlockType;
                      if (type) setBlocks((b) => [...b, newBlock(type)]);
                    }}
                  >
                    <option value="">{t("admin.cms.addBlock")}</option>
                    {BLOCK_TYPES.map((b) => (
                      <option key={b} value={b}>
                        {t(`admin.cms.blockTypes.${b}`)}
                      </option>
                    ))}
                  </Select>
                ) : null
              }
            />
            <ol className="grid gap-2 p-3">
              {(variant?.blocks ?? []).map((b, i, all) => (
                <li key={b.id} className="rounded-md border">
                  <div className="flex items-center gap-1 border-b bg-surface-2 px-2 py-1">
                    <Badge tone="accent">{t(`admin.cms.blockTypes.${b.type}`)}</Badge>
                    <span className="ms-auto" />
                    {!readOnly ? (
                      <>
                        <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} aria-label={t("admin.cms.moveUp")} onClick={() => setBlocks((x) => x.map((y, j) => (j === i - 1 ? x[i]! : j === i ? x[i - 1]! : y)))}>
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" disabled={i === all.length - 1} aria-label={t("admin.cms.moveDown")} onClick={() => setBlocks((x) => x.map((y, j) => (j === i + 1 ? x[i]! : j === i ? x[i + 1]! : y)))}>
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7 text-danger" aria-label={t("admin.cms.removeBlock")} onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <fieldset disabled={readOnly} className="p-2.5">
                    <BlockForm block={b} media={media} onChange={(nb) => setBlocks((x) => x.map((y, j) => (j === i ? nb : y)))} />
                  </fieldset>
                </li>
              ))}
              {!variant?.blocks.length ? <li className="py-6 text-center text-xs text-muted-foreground">{t("admin.cms.noBlocks")}</li> : null}
            </ol>
          </Card>
        </div>
        <div className={cn("grid content-start gap-4", view === "edit" && "hidden lg:grid")}>
          <Card className="lg:sticky lg:top-32">
            <CardHeader icon={<Eye />} title={t("admin.cms.livePreview")} description={loc} />
            <div className="max-h-[70vh] overflow-y-auto">
              <CmsPreview variant={variant} media={mediaMap} locale={loc} pricingLabel={t("admin.cms.pricingPreview")} emptyLabel={t("admin.cms.previewEmpty")} />
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("admin.cms.publishing")}>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">{t("admin.users.columns.status")}</dt>
              <dd>
                <Badge tone={entry.status === "PUBLISHED" ? "success" : entry.status === "SCHEDULED" ? "info" : entry.status === "ARCHIVED" ? "neutral" : "warning"}>{t(`admin.cms.status.${entry.status}`)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("admin.cms.liveVersion")}</dt>
              <dd className="tabular-nums">{entry.liveVersion ? `v${entry.liveVersion}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("admin.cms.lastEdit")}</dt>
              <dd>{entry.updatedBy}</dd>
            </div>
          </dl>
          {!readOnly ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("admin.cms.publishAt")} htmlFor="publish-at">
                <Input id="publish-at" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
              </Field>
              <ActionDialog
                trigger={
                  <Button size="sm" variant="secondary" disabled={!publishAt}>
                    <CalendarClock />
                    {t("admin.cms.schedule")}
                  </Button>
                }
                title={t("admin.cms.scheduleTitle")}
                description={publishAt ? new Date(publishAt).toLocaleString(uiLocale) : undefined}
                confirmLabel={t("admin.cms.schedule")}
                onConfirm={(note) => act("schedule", { note, publishAt: new Date(publishAt).toISOString() })}
              />
            </div>
          ) : null}
          {canManage ? (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {entry.hasPublished || entry.status === "SCHEDULED" ? (
                <ActionDialog trigger={<Button size="sm" variant="ghost">{t("admin.cms.unpublish")}</Button>} title={t("admin.cms.unpublishTitle")} confirmLabel={t("admin.cms.unpublish")} onConfirm={(note) => act("unpublish", { note })} />
              ) : null}
              {entry.status === "ARCHIVED" ? (
                <ActionDialog trigger={<Button size="sm" variant="secondary">{t("admin.cms.restore")}</Button>} title={t("admin.cms.restore")} confirmLabel={t("admin.cms.restore")} onConfirm={(note) => act("restore", { note })} />
              ) : (
                <ActionDialog trigger={<Button size="sm" variant="ghost" className="text-danger">{t("admin.cms.archive")}</Button>} title={t("admin.cms.archiveTitle")} description={t("admin.cms.archiveHint")} confirmLabel={t("admin.cms.archive")} danger onConfirm={(note) => act("archive", { note })} />
              )}
            </div>
          ) : null}
        </Panel>
        <Card>
          <CardHeader icon={<History />} title={t("admin.cms.versions")} description={t("admin.cms.versionsHint")} />
          {entry.versions.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t("admin.cms.noVersions")}</p>
          ) : (
            <ol className="divide-y">
              {entry.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <Badge tone={v.version === entry.liveVersion ? "success" : "neutral"} className="font-mono">
                    v{v.version}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {v.note || "—"} <span className="text-muted-foreground">· {v.createdBy} · {new Date(v.createdAt).toLocaleString(uiLocale)}</span>
                  </span>
                  {canManage && entry.status !== "ARCHIVED" ? (
                    <ActionDialog
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Undo2 />
                          {t("admin.cms.rollback")}
                        </Button>
                      }
                      title={t("admin.cms.rollbackTitle", { version: v.version })}
                      description={t("admin.cms.rollbackHint")}
                      confirmLabel={t("admin.cms.rollbackPublish")}
                      onConfirm={(note) => act("rollback", { note, version: v.version, publish: true })}
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
