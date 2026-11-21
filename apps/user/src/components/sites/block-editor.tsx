"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, Copy, Eye, EyeOff, Monitor, Plus, Rocket, Save, Smartphone, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  CONTACT_FIELDS,
  FEATURE_ICONS,
  SITE_BLOCK_TYPES,
  emptyBlock,
  newBlockId,
  type PageContent,
  type SiteBlock,
  type SiteBlockOf,
  type SiteBlockType,
  type SiteFooter,
  type SiteNav,
  type SiteTheme,
} from "@/server/modules/sites/schemas";
import { SiteBlocks, SiteFooterView, SiteHeader, themeStyle, type SiteRenderContext } from "./blocks";

export interface EditorRefs {
  assets: { id: string; title: string | null; url: string }[];
  customers: { id: string; name: string }[];
  products: { id: string; name: string; description: string }[];
}

export interface EditorPage {
  id: string;
  kind: "PAGE" | "LANDING";
  slug: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  showInNav: boolean;
  aiDrafted: boolean;
  draft: PageContent;
  hasPublished: boolean;
  hasUnpublished: boolean;
  updatedAt: string;
}

/**
 * Visual block editor with a live preview (desktop / mobile). The preview uses the same renderer as the public site,
 * so what you see is what visitors get. Saving keeps a draft; publishing snapshots a version (rollback in Versions).
 */
export function BlockEditor({
  base,
  page,
  site,
  refs,
  canManage,
  canPublish,
}: {
  base: string;
  page: EditorPage;
  site: { slug: string; name: string; theme: SiteTheme; nav: SiteNav; footer: SiteFooter; online: boolean };
  refs: EditorRefs;
  canManage: boolean;
  canPublish: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [content, setContent] = useState<PageContent>(page.draft);
  const [slug, setSlug] = useState(page.slug);
  const [kind, setKind] = useState(page.kind);
  const [showInNav, setShowInNav] = useState(page.showInNav);
  const [updatedAt, setUpdatedAt] = useState(page.updatedAt);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<string | null>(page.draft.blocks[0]?.id ?? null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const disabled = !canManage;

  const change = (next: PageContent) => {
    setContent(next);
    setDirty(true);
    setNotice(null);
  };
  const setBlock = (id: string, patch: Partial<SiteBlock>) => change({ ...content, blocks: content.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as SiteBlock) : b)) });
  const move = (i: number, d: -1 | 1) => {
    const blocks = [...content.blocks];
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
    change({ ...content, blocks });
  };
  const add = (type: SiteBlockType) => {
    const b = emptyBlock(type);
    change({ ...content, blocks: [...content.blocks, b] });
    setOpen(b.id);
  };

  async function save(): Promise<boolean> {
    setBusy("save");
    setError(null);
    try {
      const r = await api<{ updatedAt: string }>(`${base}/sites/pages/${page.id}`, { method: "PATCH", body: { content, slug, kind, showInNav, expectedUpdatedAt: updatedAt } });
      setUpdatedAt(r.updatedAt);
      setDirty(false);
      setNotice(t("sites.editor.saved"));
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function action(a: "publish" | "schedule" | "unpublish" | "cancel_schedule") {
    if (dirty && (a === "publish" || a === "schedule") && !(await save())) return;
    if (a === "unpublish" && !window.confirm(t("sites.editor.unpublishConfirm"))) return;
    setBusy(a);
    setError(null);
    try {
      await api(`${base}/sites/pages/${page.id}/actions`, { body: { action: a, ...(a === "schedule" ? { publishAt: new Date(when).toISOString() } : {}) } });
      setNotice(t(`sites.editor.done.${a}`));
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const productMap = useMemo(() => Object.fromEntries(refs.products.map((p) => [p.id, { name: p.name, description: p.description }])), [refs.products]);
  const customerMap = useMemo(() => Object.fromEntries(refs.customers.map((c) => [c.id, { name: c.name }])), [refs.customers]);
  const assetUrl = useMemo(() => {
    const m = new Map(refs.assets.map((a) => [a.id, a.url]));
    return (id: string) => m.get(id) ?? null;
  }, [refs.assets]);
  const r: SiteRenderContext = {
    base: `/s/${site.slug}`,
    theme: site.theme,
    assetUrl,
    products: productMap,
    customers: customerMap,
    mode: "preview",
    labels: { menu: t("sites.public.menu"), poweredBy: t("sites.public.poweredBy"), contactUs: t("sites.public.contactUs"), customerOf: t("sites.public.customerOf") },
  };
  const logoUrl = site.theme.logoAssetId ? assetUrl(site.theme.logoAssetId) : null;

  return (
    <div className="grid gap-4">
      {/* Toolbar */}
      <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-surface/95 p-2 shadow-elev-2 backdrop-blur">
        <Badge tone={page.status === "PUBLISHED" ? "success" : page.status === "SCHEDULED" ? "info" : "neutral"}>{t(`sites.pageStatus.${page.status}`)}</Badge>
        {page.hasUnpublished ? <Badge tone="warning">{t("sites.pages.unpublishedChanges")}</Badge> : null}
        {page.aiDrafted ? <Badge tone="brand">{t("sites.pages.aiDraft")}</Badge> : null}
        {dirty ? <span className="text-xs text-warning">{t("sites.editor.unsaved")}</span> : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5 lg:hidden" role="tablist" aria-label={t("sites.editor.view")}>
            {(["edit", "preview"] as const).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={cn("min-h-9 rounded-md px-3 text-xs", pane === p ? "bg-muted font-medium" : "text-muted-foreground")}>
                {t(`sites.editor.pane.${p}`)}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={save} loading={busy === "save"} disabled={disabled || !dirty}>
            <Save aria-hidden />
            {t("sites.editor.save")}
          </Button>
          {page.status === "SCHEDULED" ? (
            <Button size="sm" variant="ghost" onClick={() => action("cancel_schedule")} loading={busy === "cancel_schedule"} disabled={disabled}>
              <X aria-hidden />
              {t("sites.editor.cancelSchedule")}
            </Button>
          ) : (
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost" disabled={disabled || !canPublish}>
                  <CalendarClock aria-hidden />
                  {t("sites.editor.schedule")}
                </Button>
              </DialogTrigger>
              <DialogContent title={t("sites.editor.scheduleTitle")} description={t("sites.editor.scheduleHint")} closeLabel={t("common.close")}>
                <Field label={t("sites.editor.scheduleAt")} htmlFor="se-when">
                  <Input id="se-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
                <Button onClick={() => action("schedule")} loading={busy === "schedule"} disabled={!when}>
                  {t("sites.editor.schedule")}
                </Button>
              </DialogContent>
            </Dialog>
          )}
          {page.hasPublished ? (
            <Button size="sm" variant="ghost" onClick={() => action("unpublish")} loading={busy === "unpublish"} disabled={disabled}>
              <EyeOff aria-hidden />
              {t("sites.editor.unpublish")}
            </Button>
          ) : null}
          <Button size="sm" variant="luminous" onClick={() => action("publish")} loading={busy === "publish"} disabled={disabled || !canPublish || !content.blocks.length}>
            <Rocket aria-hidden />
            {page.hasPublished ? t("sites.editor.publishChanges") : t("sites.editor.publish")}
          </Button>
        </div>
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {page.status === "PUBLISHED" && !site.online ? <Notice tone="info">{t("sites.editor.siteOffline")}</Notice> : null}
      <FormError error={error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* Edit pane */}
        <div className={cn("grid content-start gap-3", pane === "preview" && "hidden lg:grid")}>
          <details className="rounded-xl border bg-surface" open={false}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
              {t("sites.editor.pageSettings")}
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
            </summary>
            <div className="grid gap-3 border-t p-4">
              <Field label={t("sites.editor.pageTitle")} htmlFor="pe-title">
                <Input id="pe-title" value={content.title} maxLength={160} disabled={disabled} onChange={(e) => change({ ...content, title: e.target.value })} />
              </Field>
              <Field label={t("sites.editor.path")} htmlFor="pe-slug" hint={t("sites.editor.pathHint", { path: `/s/${site.slug}${slug ? `/${slug}` : ""}` })}>
                <Input id="pe-slug" value={slug} maxLength={180} disabled={disabled} className="font-mono" onChange={(e) => (setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9/-]/g, "-")), setDirty(true))} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("sites.editor.kind")} htmlFor="pe-kind">
                  <Select id="pe-kind" value={kind} disabled={disabled} onChange={(e) => (setKind(e.target.value as "PAGE" | "LANDING"), setDirty(true))}>
                    <option value="PAGE">{t("sites.kinds.PAGE")}</option>
                    <option value="LANDING">{t("sites.kinds.LANDING")}</option>
                  </Select>
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" className="size-4" checked={showInNav} disabled={disabled} onChange={(e) => (setShowInNav(e.target.checked), setDirty(true))} />
                  {t("sites.editor.showInNav")}
                </label>
              </div>
              <Field label={t("sites.editor.seoTitle")} htmlFor="pe-seot" hint={`${content.seo.title.length}/70`}>
                <Input id="pe-seot" value={content.seo.title} maxLength={70} disabled={disabled} onChange={(e) => change({ ...content, seo: { ...content.seo, title: e.target.value } })} />
              </Field>
              <Field label={t("sites.editor.seoDescription")} htmlFor="pe-seod" hint={`${content.seo.description.length}/170`}>
                <Textarea id="pe-seod" rows={2} value={content.seo.description} maxLength={170} disabled={disabled} onChange={(e) => change({ ...content, seo: { ...content.seo, description: e.target.value } })} />
              </Field>
              <AssetSelect id="pe-og" label={t("sites.editor.ogImage")} value={content.seo.ogImage} assets={refs.assets} disabled={disabled} onChange={(v) => change({ ...content, seo: { ...content.seo, ogImage: v } })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={content.seo.noIndex} disabled={disabled} onChange={(e) => change({ ...content, seo: { ...content.seo, noIndex: e.target.checked } })} />
                {t("sites.editor.noIndex")}
              </label>
            </div>
          </details>

          <ol className="grid gap-2" aria-label={t("sites.editor.blocks")}>
            {content.blocks.map((b, i) => (
              <li key={b.id} className={cn("rounded-xl border bg-surface transition-shadow", open === b.id && "shadow-elev-2 ring-1 ring-primary/30")}>
                <div className="flex items-center gap-1 p-1.5 ps-3">
                  <button type="button" className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-start text-sm" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t(`sites.blocks.${b.type}.name`)}</span>
                    <span className="truncate">{blockLabel(b)}</span>
                  </button>
                  <Button size="icon" variant="ghost" aria-label={t("sites.editor.moveUp")} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={t("sites.editor.moveDown")} disabled={disabled || i === content.blocks.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={t("sites.editor.duplicate")} disabled={disabled} onClick={() => change({ ...content, blocks: [...content.blocks.slice(0, i + 1), { ...b, id: newBlockId() }, ...content.blocks.slice(i + 1)] })}>
                    <Copy aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={t("sites.editor.remove")} disabled={disabled} onClick={() => change({ ...content, blocks: content.blocks.filter((x) => x.id !== b.id) })}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                {open === b.id ? (
                  <div className="grid gap-3 border-t p-4">
                    <BlockForm b={b} set={(patch) => setBlock(b.id, patch)} refs={refs} disabled={disabled} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {!content.blocks.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("sites.editor.empty")}</p> : null}

          <fieldset className="grid gap-2 rounded-xl border border-dashed p-3" disabled={disabled}>
            <legend className="px-1 text-xs font-medium text-muted-foreground">{t("sites.editor.addBlock")}</legend>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
              {SITE_BLOCK_TYPES.map((type) => (
                <button key={type} type="button" onClick={() => add(type)} className="flex min-h-10 items-center gap-1.5 rounded-lg border bg-surface px-2.5 text-start text-xs hover:border-border-strong hover:bg-muted">
                  <Plus className="size-3.5 shrink-0 text-primary" aria-hidden />
                  {t(`sites.blocks.${type}.name`)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Preview pane */}
        <div className={cn("grid content-start gap-2", pane === "edit" && "hidden lg:grid")}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="size-3.5" aria-hidden />
              {t("sites.editor.preview")}
            </span>
            <div className="flex rounded-lg border p-0.5" role="group" aria-label={t("sites.editor.device")}>
              {(["desktop", "mobile"] as const).map((d) => (
                <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={cn("flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs", device === d ? "bg-muted font-medium" : "text-muted-foreground")}>
                  {d === "desktop" ? <Monitor className="size-3.5" aria-hidden /> : <Smartphone className="size-3.5" aria-hidden />}
                  {t(`sites.editor.devices.${d}`)}
                </button>
              ))}
            </div>
          </div>
          <div className={cn("mx-auto w-full overflow-hidden rounded-xl border bg-white shadow-elev-3 transition-[max-width] duration-300", device === "mobile" ? "max-w-[390px] rounded-[2rem] border-8 border-slate-800" : "max-w-none")}>
            <div className={cn("@container max-h-[78vh] overflow-y-auto overscroll-contain text-[15px] text-slate-900")} style={themeStyle(site.theme)} lang={locale}>
              <SiteHeader name={site.name} nav={site.nav} r={r} logoUrl={logoUrl} />
              <SiteBlocks content={content} r={r} />
              <SiteFooterView name={site.name} footer={site.footer} r={r} />
            </div>
          </div>
          {device === "mobile" ? <p className="text-center text-xs text-muted-foreground">{t("sites.editor.mobileNote")}</p> : null}
        </div>
      </div>
    </div>
  );
}

function blockLabel(b: SiteBlock): string {
  if ("title" in b && b.title) return b.title;
  if (b.type === "richText") return b.body.replace(/[#*]/g, "").trim().slice(0, 60);
  if (b.type === "image") return b.alt || b.caption;
  return "";
}

// ───────────── Field helpers ─────────────

function TextField({ id, label, value, onChange, max, disabled, area, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; max: number; disabled: boolean; area?: number; hint?: ReactNode }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {area ? <Textarea id={id} rows={area} value={value} maxLength={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} /> : <Input id={id} value={value} maxLength={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function AssetSelect({ id, label, value, assets, onChange, disabled }: { id: string; label: string; value: string; assets: EditorRefs["assets"]; onChange: (v: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const current = value.startsWith("asset:") ? value.slice(6) : "";
  return (
    <Field label={label} htmlFor={id} hint={!assets.length ? t("sites.editor.noAssets") : undefined}>
      <div className="flex items-center gap-2">
        {current && assets.find((a) => a.id === current) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assets.find((a) => a.id === current)!.url} alt="" className="size-10 shrink-0 rounded-md border object-cover" />
        ) : null}
        <Select id={id} value={current} disabled={disabled || !assets.length} onChange={(e) => onChange(e.target.value ? `asset:${e.target.value}` : "")}>
          <option value="">{t("sites.editor.noImage")}</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title || a.id.slice(0, 8)}
            </option>
          ))}
        </Select>
      </div>
    </Field>
  );
}

function ListEditor<T>({ items, onChange, make, render, addLabel, max, disabled }: { items: T[]; onChange: (v: T[]) => void; make: () => T; render: (item: T, set: (v: T) => void, i: number) => ReactNode; addLabel: string; max: number; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      {items.map((it, i) => (
        <div key={i} className="relative grid gap-2 rounded-lg border bg-surface-2/50 p-3 pe-10">
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}
          <button type="button" aria-label={t("sites.editor.remove")} disabled={disabled} onClick={() => onChange(items.filter((_, j) => j !== i))} className="absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-danger">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      {items.length < max ? (
        <Button size="sm" variant="secondary" className="w-fit" disabled={disabled} onClick={() => onChange([...items, make()])}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

function BlockForm({ b, set, refs, disabled }: { b: SiteBlock; set: (patch: Partial<SiteBlock>) => void; refs: EditorRefs; disabled: boolean }) {
  const { t } = useI18n();
  const f = (k: string) => t(`sites.blockFields.${k}`);
  const id = (k: string) => `bf-${b.id}-${k}`;
  const txt = (k: string, value: string, max: number, area?: number) => <TextField id={id(k)} label={f(k)} value={value} max={max} area={area} disabled={disabled} onChange={(v) => set({ [k]: v } as Partial<SiteBlock>)} />;
  const link = (k: string, value: string) => <TextField id={id(k)} label={f(k)} value={value} max={500} disabled={disabled} hint={t("sites.blockFields.linkHint")} onChange={(v) => set({ [k]: v } as Partial<SiteBlock>)} />;
  switch (b.type) {
    case "hero":
      return (
        <>
          {txt("eyebrow", b.eyebrow, 80)}
          {txt("title", b.title, 160)}
          {txt("subtitle", b.subtitle, 400, 3)}
          <div className="grid gap-3 sm:grid-cols-2">
            {txt("ctaLabel", b.ctaLabel, 60)}
            {link("ctaHref", b.ctaHref)}
            {txt("secondaryLabel", b.secondaryLabel, 60)}
            {link("secondaryHref", b.secondaryHref)}
          </div>
          <AssetSelect id={id("image")} label={f("image")} value={b.image} assets={refs.assets} disabled={disabled} onChange={(v) => set({ image: v })} />
          <Field label={f("layout")} htmlFor={id("layout")}>
            <Select id={id("layout")} value={b.layout} disabled={disabled} onChange={(e) => set({ layout: e.target.value as "split" | "centered" })}>
              <option value="split">{t("sites.blockFields.layouts.split")}</option>
              <option value="centered">{t("sites.blockFields.layouts.centered")}</option>
            </Select>
          </Field>
        </>
      );
    case "features":
      return (
        <>
          {txt("title", b.title, 160)}
          {txt("subtitle", b.subtitle, 400, 2)}
          <ListEditor
            items={b.items}
            max={12}
            disabled={disabled}
            addLabel={t("sites.blockFields.addItem")}
            make={() => ({ icon: "sparkles" as const, title: "", body: "" })}
            onChange={(items) => set({ items } as Partial<SiteBlockOf<"features">>)}
            render={(it, s, i) => (
              <>
                <Select aria-label={f("icon")} value={it.icon} disabled={disabled} onChange={(e) => s({ ...it, icon: e.target.value as typeof it.icon })}>
                  {FEATURE_ICONS.map((ic) => (
                    <option key={ic} value={ic}>
                      {t(`sites.icons.${ic}`)}
                    </option>
                  ))}
                </Select>
                <Input aria-label={`${f("itemTitle")} ${i + 1}`} placeholder={f("itemTitle")} value={it.title} maxLength={120} disabled={disabled} onChange={(e) => s({ ...it, title: e.target.value })} />
                <Textarea aria-label={`${f("itemBody")} ${i + 1}`} placeholder={f("itemBody")} rows={2} value={it.body} maxLength={400} disabled={disabled} onChange={(e) => s({ ...it, body: e.target.value })} />
              </>
            )}
          />
        </>
      );
    case "richText":
      return <TextField id={id("body")} label={f("body")} value={b.body} max={20_000} area={10} disabled={disabled} hint={t("sites.blockFields.richHint")} onChange={(v) => set({ body: v })} />;
    case "image":
      return (
        <>
          <AssetSelect id={id("image")} label={f("image")} value={b.image} assets={refs.assets} disabled={disabled} onChange={(v) => set({ image: v })} />
          {txt("alt", b.alt, 200)}
          {txt("caption", b.caption, 300)}
          <Field label={f("width")} htmlFor={id("width")}>
            <Select id={id("width")} value={b.width} disabled={disabled} onChange={(e) => set({ width: e.target.value as "content" | "wide" })}>
              <option value="wide">{t("sites.blockFields.widths.wide")}</option>
              <option value="content">{t("sites.blockFields.widths.content")}</option>
            </Select>
          </Field>
        </>
      );
    case "cta":
      return (
        <>
          {txt("title", b.title, 160)}
          {txt("body", b.body, 400, 2)}
          <div className="grid gap-3 sm:grid-cols-2">
            {txt("ctaLabel", b.ctaLabel, 60)}
            {link("ctaHref", b.ctaHref)}
          </div>
        </>
      );
    case "faq":
      return (
        <>
          {txt("title", b.title, 160)}
          <ListEditor
            items={b.items}
            max={30}
            disabled={disabled}
            addLabel={t("sites.blockFields.addQuestion")}
            make={() => ({ q: "", a: "" })}
            onChange={(items) => set({ items } as Partial<SiteBlockOf<"faq">>)}
            render={(it, s, i) => (
              <>
                <Input aria-label={`${f("question")} ${i + 1}`} placeholder={f("question")} value={it.q} maxLength={300} disabled={disabled} onChange={(e) => s({ ...it, q: e.target.value })} />
                <Textarea aria-label={`${f("answer")} ${i + 1}`} placeholder={f("answer")} rows={3} value={it.a} maxLength={2000} disabled={disabled} onChange={(e) => s({ ...it, a: e.target.value })} />
              </>
            )}
          />
        </>
      );
    case "testimonials":
      return (
        <>
          <Notice tone="info">{t("sites.blockFields.customersOnly")}</Notice>
          {txt("title", b.title, 160)}
          {refs.customers.length ? (
            <ListEditor
              items={b.items}
              max={9}
              disabled={disabled}
              addLabel={t("sites.blockFields.addTestimonial")}
              make={() => ({ accountId: refs.customers[0]!.id, quote: "", author: "", role: "" })}
              onChange={(items) => set({ items } as Partial<SiteBlockOf<"testimonials">>)}
              render={(it, s, i) => (
                <>
                  <Select aria-label={`${f("customer")} ${i + 1}`} value={it.accountId} disabled={disabled} onChange={(e) => s({ ...it, accountId: e.target.value })}>
                    {refs.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Textarea aria-label={`${f("quote")} ${i + 1}`} placeholder={f("quote")} rows={3} value={it.quote} maxLength={600} disabled={disabled} onChange={(e) => s({ ...it, quote: e.target.value })} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input aria-label={f("author")} placeholder={f("author")} value={it.author} maxLength={120} disabled={disabled} onChange={(e) => s({ ...it, author: e.target.value })} />
                    <Input aria-label={f("role")} placeholder={f("role")} value={it.role} maxLength={120} disabled={disabled} onChange={(e) => s({ ...it, role: e.target.value })} />
                  </div>
                </>
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("sites.blockFields.noCustomers")}</p>
          )}
        </>
      );
    case "pricing":
      return (
        <>
          <Notice tone="info">{t("sites.blockFields.productsOnly")}</Notice>
          {txt("title", b.title, 160)}
          {txt("subtitle", b.subtitle, 400, 2)}
          {refs.products.length ? (
            <ListEditor
              items={b.items}
              max={6}
              disabled={disabled}
              addLabel={t("sites.blockFields.addProduct")}
              make={() => ({ productId: refs.products[0]!.id, price: "", period: "", features: [], highlight: false, ctaLabel: "", ctaHref: "" })}
              onChange={(items) => set({ items } as Partial<SiteBlockOf<"pricing">>)}
              render={(it, s, i) => (
                <>
                  <Select aria-label={`${f("product")} ${i + 1}`} value={it.productId} disabled={disabled} onChange={(e) => s({ ...it, productId: e.target.value })}>
                    {refs.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input aria-label={f("price")} placeholder={f("price")} value={it.price} maxLength={40} disabled={disabled} onChange={(e) => s({ ...it, price: e.target.value })} />
                    <Input aria-label={f("period")} placeholder={f("period")} value={it.period} maxLength={40} disabled={disabled} onChange={(e) => s({ ...it, period: e.target.value })} />
                  </div>
                  <Textarea aria-label={f("features")} placeholder={f("features")} rows={3} value={it.features.join("\n")} disabled={disabled} onChange={(e) => s({ ...it, features: e.target.value.split("\n").slice(0, 10).map((x) => x.slice(0, 160)) })} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input aria-label={f("ctaLabel")} placeholder={f("ctaLabel")} value={it.ctaLabel} maxLength={60} disabled={disabled} onChange={(e) => s({ ...it, ctaLabel: e.target.value })} />
                    <Input aria-label={f("ctaHref")} placeholder={f("ctaHref")} value={it.ctaHref} maxLength={500} disabled={disabled} onChange={(e) => s({ ...it, ctaHref: e.target.value })} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={it.highlight} disabled={disabled} onChange={(e) => s({ ...it, highlight: e.target.checked })} />
                    {f("highlight")}
                  </label>
                </>
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("sites.blockFields.noProducts")}</p>
          )}
        </>
      );
    case "contactForm": {
      const has = (k: (typeof CONTACT_FIELDS)[number]) => b.fields.find((x) => x.key === k);
      const toggle = (k: (typeof CONTACT_FIELDS)[number], on: boolean) => set({ fields: on ? CONTACT_FIELDS.filter((x) => x === k || has(x)).map((x) => has(x) ?? { key: x, required: false }) : b.fields.filter((x) => x.key !== k) });
      return (
        <>
          {txt("title", b.title, 160)}
          {txt("body", b.body, 600, 2)}
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">{f("fields")}</legend>
            {CONTACT_FIELDS.map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <label className="flex min-w-32 items-center gap-2">
                  <input type="checkbox" className="size-4" checked={!!has(k)} disabled={disabled || k === "email"} onChange={(e) => toggle(k, e.target.checked)} />
                  {t(`sites.public.form.${k}`)}
                </label>
                {has(k) ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" className="size-3.5" checked={has(k)!.required} disabled={disabled || k === "email"} onChange={(e) => set({ fields: b.fields.map((x) => (x.key === k ? { ...x, required: e.target.checked } : x)) })} />
                    {f("required")}
                  </label>
                ) : null}
              </div>
            ))}
          </fieldset>
          {txt("submitLabel", b.submitLabel, 60)}
          {txt("successMessage", b.successMessage, 300)}
          <TextField id={id("consentText")} label={f("consentText")} value={b.consentText} max={600} area={2} disabled={disabled} hint={t("sites.blockFields.consentHint")} onChange={(v) => set({ consentText: v })} />
          <p className="text-xs text-muted-foreground">{t("sites.blockFields.formLeads")}</p>
        </>
      );
    }
    case "logoStrip":
      return (
        <>
          {txt("title", b.title, 160)}
          <p className="text-xs text-muted-foreground">{t("sites.blockFields.logosHint")}</p>
          <ListEditor
            items={b.items}
            max={12}
            disabled={disabled}
            addLabel={t("sites.blockFields.addLogo")}
            make={() => ({ name: "", image: "" })}
            onChange={(items) => set({ items } as Partial<SiteBlockOf<"logoStrip">>)}
            render={(it, s, i) => (
              <>
                <Input aria-label={`${f("logoName")} ${i + 1}`} placeholder={f("logoName")} value={it.name} maxLength={120} disabled={disabled} onChange={(e) => s({ ...it, name: e.target.value })} />
                <AssetSelect id={`${id("logo")}-${i}`} label={f("image")} value={it.image} assets={refs.assets} disabled={disabled} onChange={(v) => s({ ...it, image: v })} />
              </>
            )}
          />
        </>
      );
  }
}
