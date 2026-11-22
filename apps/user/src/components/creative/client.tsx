"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Download, Maximize2, Plus, RefreshCw, ScanSearch, SkipForward, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/form-error";
import { useAction } from "@/components/comms/client";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  CATEGORY_PRESET,
  IMAGE_CATEGORIES,
  IMAGE_STYLES,
  OPENAI_VOICES,
  PLATFORM_PRESET_KEYS,
  PLATFORM_PRESETS,
  PLATFORMS,
  SCENE_VIDEO_PROVIDERS,
  RENDER_PROVIDERS,
  VIDEO_ASPECTS,
  VIDEO_TEMPLATES,
  VOICE_PROVIDERS,
  type ImageCategory,
  type PlatformPreset,
} from "@/server/modules/creative/presets";

interface Option {
  id: string;
  name: string;
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

function Chips<T extends string>({ value, options, onChange, label, render }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; render: (v: T) => ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn("rounded-full border px-3 py-1 text-xs transition-colors", value === o ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60")}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

// ───────────── Image studio ─────────────

export function ImageGenerator({ base, campaigns, folders, connected, brandReady }: { base: string; campaigns: Option[]; folders: Option[]; connected: boolean; brandReady: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<ImageCategory>("social");
  const [style, setStyle] = useState<string>("");
  const [preset, setPreset] = useState<PlatformPreset>(CATEGORY_PRESET.social);
  const [variants, setVariants] = useState(2);
  const [useBrand, setUseBrand] = useState(true);
  const [textSpace, setTextSpace] = useState<string>("");
  const [campaignId, setCampaignId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [done, setDone] = useState<number | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        void run(
          () => api<{ created: string[] }>(`${base}/creative/images`, { body: { prompt, category, style: style || null, preset, variants, useBrand, textSpace: textSpace || null, campaignId: campaignId || null, folderId: folderId || null } }),
          (r) => setDone(r.created.length),
        );
      }}
    >
      <Field label={t("creative.images.category")} htmlFor="img-category">
        <Chips
          label={t("creative.images.category")}
          value={category}
          options={IMAGE_CATEGORIES}
          onChange={(c) => {
            setCategory(c);
            setPreset(CATEGORY_PRESET[c]);
          }}
          render={(c) => t(`creative.categories.${c}`)}
        />
      </Field>
      <Field label={t("creative.images.prompt")} htmlFor="img-prompt" hint={t("creative.images.promptHint")}>
        <Textarea id="img-prompt" rows={4} required minLength={3} maxLength={3000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("creative.images.promptPlaceholder")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("creative.images.preset")} htmlFor="img-preset">
          <Select id="img-preset" value={preset} onChange={(e) => setPreset(e.target.value as PlatformPreset)}>
            {PLATFORM_PRESET_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`creative.presets.${k}`)} · {PLATFORM_PRESETS[k].width}×{PLATFORM_PRESETS[k].height}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.images.style")} htmlFor="img-style">
          <Select id="img-style" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">{t("creative.images.styleAuto")}</option>
            {IMAGE_STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`creative.styles.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.images.variants")} htmlFor="img-variants" hint={t("creative.images.variantsHint")}>
          <Select id="img-variants" value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.images.textSpace")} htmlFor="img-text">
          <Select id="img-text" value={textSpace} onChange={(e) => setTextSpace(e.target.value)}>
            <option value="">{t("creative.images.textNone")}</option>
            {(["top", "center", "bottom"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`creative.images.text_${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.common.campaign")} htmlFor="img-campaign">
          <Select id="img-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">{t("creative.common.none")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.common.folder")} htmlFor="img-folder">
          <Select id="img-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">{t("creative.common.none")}</option>
            {folders.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Toggle id="img-brand" checked={useBrand} onChange={setUseBrand} label={t("creative.images.useBrand")} hint={brandReady ? t("creative.images.useBrandHint") : t("creative.images.noBrandHint")} />
      <FormError error={error} />
      {done !== null ? <Notice tone="success">{t("creative.images.done", { count: done })}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !connected || prompt.trim().length < 3} aria-busy={busy}>
          <Sparkles aria-hidden />
          {busy ? t("creative.images.generating") : t("creative.images.generate", { count: variants })}
        </Button>
        <span className="text-xs text-muted-foreground">{t("creative.images.costHint")}</span>
      </div>
    </form>
  );
}

/** Regenerate / edit / upscale / brand-check / download actions on one image. */
export function ImageActions({ base, assetId, canManage, compact = false }: { base: string; assetId: string; canManage: boolean; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [instruction, setInstruction] = useState("");
  const [open, setOpen] = useState(false);
  const go = (body: Record<string, unknown>) => run(() => api<{ id: string }>(`${base}/creative/images/${assetId}`, { body }), (r) => (compact ? undefined : router.push(`./${r.id}`)));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        <a href={`${base}/creative/library/${assetId}/download`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted" target="_blank" rel="noreferrer">
          <Download className="size-3.5" aria-hidden />
          {t("creative.actions.download")}
        </a>
        {canManage ? (
          <>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void go({ action: "regenerate" })}>
              <RefreshCw aria-hidden />
              {t("creative.actions.regenerate")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant="secondary" disabled={busy}>
                  <Wand2 aria-hidden />
                  {t("creative.actions.edit")}
                </Button>
              </DialogTrigger>
              <DialogContent title={t("creative.actions.editTitle")} description={t("creative.actions.editHint")} closeLabel={t("common.close")}>
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void go({ action: "edit", instruction }).then((r) => r && setOpen(false));
                  }}
                >
                  <Textarea rows={3} required minLength={3} maxLength={2000} value={instruction} onChange={(e) => setInstruction(e.target.value)} aria-label={t("creative.actions.editTitle")} placeholder={t("creative.actions.editPlaceholder")} />
                  <FormError error={error} />
                  <Button type="submit" disabled={busy} aria-busy={busy}>
                    {busy ? t("creative.common.working") : t("creative.actions.applyEdit")}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void go({ action: "upscale" })}>
              <Maximize2 aria-hidden />
              {t("creative.actions.upscale")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/creative/library/${assetId}/brand-check`, { body: {} }))}>
              <ScanSearch aria-hidden />
              {t("creative.actions.brandCheck")}
            </Button>
          </>
        ) : null}
      </div>
      {!open ? <FormError error={error} /> : null}
      {busy ? <p className="text-xs text-muted-foreground" role="status">{t("creative.common.working")}</p> : null}
    </div>
  );
}

// ───────────── Library ─────────────

export function UploadForm({ base, folders }: { base: string; folders: Option[] }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState("");
  const [license, setLicense] = useState("");
  const isAudio = !!file?.type.startsWith("audio/");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        void run(async () => api(`${base}/creative/library`, { body: { name: name || file.name, mimeType: file.type, dataBase64: await readFile(file), folderId: folderId || null, ...(isAudio ? { licenseNote: license } : {}) } }), () => {
          setFile(null);
          setName("");
        });
      }}
    >
      <Field label={t("creative.library.file")} htmlFor="up-file" hint={t("creative.library.fileHint")}>
        <Input id="up-file" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/ogg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("creative.common.name")} htmlFor="up-name">
          <Input id="up-name" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder={file?.name ?? ""} />
        </Field>
        <Field label={t("creative.common.folder")} htmlFor="up-folder">
          <Select id="up-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">{t("creative.common.none")}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {isAudio ? (
        <Field label={t("creative.music.licenseNote")} htmlFor="up-license" hint={t("creative.music.licenseHint")}>
          <Input id="up-license" required minLength={3} maxLength={500} value={license} onChange={(e) => setLicense(e.target.value)} />
        </Field>
      ) : null}
      <FormError error={error} />
      <Button type="submit" variant="secondary" disabled={busy || !file || file.size > 15 * 1024 * 1024 || (isAudio && license.trim().length < 3)} aria-busy={busy}>
        <Upload aria-hidden />
        {busy ? t("creative.common.working") : t("creative.library.upload")}
      </Button>
      {file && file.size > 15 * 1024 * 1024 ? <p className="text-xs text-danger">{t("creative.library.tooLarge")}</p> : null}
    </form>
  );
}

export function FolderForm({ base }: { base: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/creative/folders`, { body: { name } }), () => setName(""));
      }}
    >
      <div className="flex gap-2">
        <Input aria-label={t("creative.library.newFolder")} placeholder={t("creative.library.newFolder")} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !name.trim()}>
          <Plus aria-hidden />
          <span className="sr-only">{t("creative.library.newFolder")}</span>
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function DeleteButton({ path, label, confirm, after }: { path: string; label: string; confirm: string; after?: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(confirm)) return;
          void run(() => api(path, { method: "DELETE" }), () => (after ? router.push(after) : undefined));
        }}
      >
        <Trash2 aria-hidden />
        {label}
      </Button>
      <FormError error={error} />
    </span>
  );
}

export function AssetEditForm({ base, asset, folders, campaigns }: { base: string; asset: { id: string; name: string; tags: string[]; folderId: string | null; campaignId: string | null; category: string | null }; folders: Option[]; campaigns: Option[] }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [folderId, setFolderId] = useState(asset.folderId ?? "");
  const [campaignId, setCampaignId] = useState(asset.campaignId ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(
          () => api(`${base}/creative/library/${asset.id}`, { method: "PATCH", body: { name, tags: tags.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20), folderId: folderId || null, campaignId: campaignId || null } }),
          () => setSaved(true),
        );
      }}
    >
      <Field label={t("creative.common.name")} htmlFor="ae-name">
        <Input id="ae-name" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("creative.library.tags")} htmlFor="ae-tags" hint={t("creative.library.tagsHint")}>
        <Input id="ae-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("creative.common.folder")} htmlFor="ae-folder">
          <Select id="ae-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">{t("creative.common.none")}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.common.campaign")} htmlFor="ae-campaign">
          <Select id="ae-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">{t("creative.common.none")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {t("creative.common.save")}
        </Button>
        {saved ? <span className="text-xs text-success" role="status">{t("creative.common.saved")}</span> : null}
      </div>
    </form>
  );
}

export function TemplateForm({ base }: { base: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ImageCategory>("social");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/creative/templates`, { body: { kind: "IMAGE_SET", name, category, prompt, style: style || null, preset: CATEGORY_PRESET[category] } }), () => {
          setName("");
          setPrompt("");
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("creative.common.name")} htmlFor="tp-name">
          <Input id="tp-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("creative.images.category")} htmlFor="tp-cat">
          <Select id="tp-cat" value={category} onChange={(e) => setCategory(e.target.value as ImageCategory)}>
            {IMAGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`creative.categories.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.images.style")} htmlFor="tp-style">
          <Select id="tp-style" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">{t("creative.images.styleAuto")}</option>
            {IMAGE_STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`creative.styles.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("creative.images.prompt")} htmlFor="tp-prompt">
        <Textarea id="tp-prompt" rows={3} required minLength={3} maxLength={3000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="secondary" disabled={busy}>
        {t("creative.templates.save")}
      </Button>
    </form>
  );
}

/** Use an image template: generate with its prompt, category, style and preset. */
export function UseTemplateButton({ base, template, disabled }: { base: string; template: { id: string; prompt: string; category: string; style: string | null; preset: string | null }; disabled: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || disabled}
        onClick={() =>
          void run(() =>
            api(`${base}/creative/images`, {
              body: { prompt: template.prompt, category: (IMAGE_CATEGORIES as readonly string[]).includes(template.category) ? template.category : "social", style: template.style, ...(template.preset && template.preset in PLATFORM_PRESETS ? { preset: template.preset } : {}), variants: 1, templateId: template.id },
            }),
          )
        }
      >
        <Sparkles aria-hidden />
        {busy ? t("creative.common.working") : t("creative.templates.use")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

// ───────────── Video projects ─────────────

export function NewProjectForm({ base, locale, campaigns, connected }: { base: string; locale: string; campaigns: Option[]; connected: string[] }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", brief: "", audience: "", objective: "", aspect: "9:16", targetSeconds: 30, platforms: ["instagram", "tiktok"] as string[], templateKey: "", research: false, sceneMedia: "image", campaignId: "", autoAdvance: false });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const hasVideo = SCENE_VIDEO_PROVIDERS.some((p) => connected.includes(p));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button magnetic>
          <Plus aria-hidden />
          {t("creative.projects.new")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("creative.projects.newTitle")} description={t("creative.projects.newHint")} closeLabel={t("common.close")} className="max-w-2xl">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                api<{ id: string }>(`${base}/creative/projects`, {
                  body: {
                    name: f.name,
                    brief: f.brief,
                    kind: "VIDEO",
                    audience: f.audience || null,
                    objective: f.objective || null,
                    aspect: f.aspect,
                    targetSeconds: f.targetSeconds,
                    platforms: f.platforms,
                    campaignId: f.campaignId || null,
                    autoAdvance: f.autoAdvance,
                    settings: { templateKey: f.templateKey || null, research: f.research, sceneMedia: f.sceneMedia },
                  },
                }),
              (r) => router.push(`/${locale}/studio/projects/${r.id}`),
            );
          }}
        >
          <Field label={t("creative.projects.name")} htmlFor="np-name">
            <Input id="np-name" required maxLength={160} value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("creative.projects.brief")} htmlFor="np-brief" hint={t("creative.projects.briefHint")}>
            <Textarea id="np-brief" rows={4} required minLength={10} maxLength={4000} value={f.brief} onChange={(e) => set("brief", e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("creative.projects.audience")} htmlFor="np-aud">
              <Input id="np-aud" maxLength={500} value={f.audience} onChange={(e) => set("audience", e.target.value)} />
            </Field>
            <Field label={t("creative.projects.objective")} htmlFor="np-obj">
              <Input id="np-obj" maxLength={500} value={f.objective} onChange={(e) => set("objective", e.target.value)} />
            </Field>
            <Field label={t("creative.projects.template")} htmlFor="np-tpl">
              <Select
                id="np-tpl"
                value={f.templateKey}
                onChange={(e) => {
                  const tpl = VIDEO_TEMPLATES.find((x) => x.key === e.target.value);
                  setF((p) => ({ ...p, templateKey: e.target.value, ...(tpl ? { aspect: tpl.aspect, targetSeconds: tpl.seconds } : {}) }));
                }}
              >
                <option value="">{t("creative.projects.noTemplate")}</option>
                {VIDEO_TEMPLATES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {t(`creative.videoTemplates.${x.key}`)} · {x.aspect} · {x.seconds}s
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("creative.common.campaign")} htmlFor="np-camp">
              <Select id="np-camp" value={f.campaignId} onChange={(e) => set("campaignId", e.target.value)}>
                <option value="">{t("creative.common.none")}</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("creative.projects.aspect")} htmlFor="np-aspect">
              <Select id="np-aspect" value={f.aspect} onChange={(e) => set("aspect", e.target.value)}>
                {VIDEO_ASPECTS.map((a) => (
                  <option key={a} value={a}>
                    {t(`creative.aspects.${a.replace(":", "x")}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("creative.projects.seconds")} htmlFor="np-sec">
              <Input id="np-sec" type="number" min={5} max={180} value={f.targetSeconds} onChange={(e) => set("targetSeconds", Math.max(5, Math.min(180, Number(e.target.value) || 30)))} />
            </Field>
          </div>
          <Field label={t("creative.projects.platforms")} htmlFor="np-platforms">
            <div id="np-platforms" className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={f.platforms.includes(p)}
                  onClick={() => set("platforms", f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p])}
                  className={cn("rounded-full border px-3 py-1 text-xs", f.platforms.includes(p) ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted/60")}
                >
                  {t(`creative.platforms.${p}`)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("creative.projects.sceneMedia")} htmlFor="np-media" hint={hasVideo ? t("creative.projects.sceneMediaHint") : t("creative.projects.sceneMediaNoVideo")}>
            <Select id="np-media" value={f.sceneMedia} onChange={(e) => set("sceneMedia", e.target.value)}>
              <option value="image">{t("creative.projects.media_image")}</option>
              <option value="video">{t("creative.projects.media_video")}</option>
            </Select>
          </Field>
          <Toggle id="np-research" checked={f.research} onChange={(v) => set("research", v)} label={t("creative.projects.research")} hint={t("creative.projects.researchHint")} />
          <Toggle id="np-auto" checked={f.autoAdvance} onChange={(v) => set("autoAdvance", v)} label={t("creative.projects.autoAdvance")} hint={t("creative.projects.autoAdvanceHint")} />
          <FormError error={error} />
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t("creative.common.working") : t("creative.projects.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Run / re-run / skip a pipeline step. */
export function StepActions({ base, projectId, step, status, skippable, ready }: { base: string; projectId: string; step: string; status: string; skippable: boolean; ready: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const act = (action: "run" | "rerun" | "skip") => run(() => api(`${base}/creative/projects/${projectId}/steps/${step}`, { body: { action } }));
  const busyNow = busy || status === "RUNNING" || status === "WAITING_PROVIDER";
  const done = status === "SUCCEEDED" || status === "SKIPPED";
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {step !== "review" && step !== "handoff" && step !== "idea" && step !== "music" ? (
          done ? (
            <Button type="button" size="sm" variant="ghost" disabled={busyNow || !ready} onClick={() => void act("rerun")}>
              <RefreshCw aria-hidden />
              {t("creative.steps.rerun")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busyNow || !ready} onClick={() => void act("run")} aria-busy={busy}>
              <Sparkles aria-hidden />
              {busy ? t("creative.common.working") : status === "FAILED" || status === "BLOCKED" ? t("creative.steps.retry") : t("creative.steps.run")}
            </Button>
          )
        ) : null}
        {step === "review" && !done && status !== "NEEDS_INPUT" ? (
          <Button type="button" size="sm" disabled={busyNow || !ready} onClick={() => void act("run")}>
            {t("creative.steps.requestReview")}
          </Button>
        ) : null}
        {skippable && !done && !busyNow ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void act("skip")}>
            <SkipForward aria-hidden />
            {t("creative.steps.skip")}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Edit the text output of concept / script / hook. */
export function TextStepEditor({ base, projectId, step, value, options, canManage }: { base: string; projectId: string; step: "concept" | "script" | "hook"; value: string; options?: string[]; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(() => api(`${base}/creative/projects/${projectId}/steps/${step}`, { body: { action: "edit", text } }), () => setSaved(true));
      }}
    >
      {options && options.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={t("creative.steps.hookOptions")}>
          {options.map((o) => (
            <button key={o} type="button" disabled={!canManage} onClick={() => setText(o)} className={cn("rounded-md border px-2 py-1 text-start text-xs", o === text ? "border-primary bg-primary/10" : "hover:bg-muted/60")}>
              {o}
            </button>
          ))}
        </div>
      ) : null}
      <Textarea rows={step === "script" ? 9 : step === "hook" ? 2 : 6} value={text} onChange={(e) => setText(e.target.value)} readOnly={!canManage} aria-label={t(`creative.steps.names.${step}`)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("creative.steps.words", { count: words, seconds: Math.round(words / 2.4) })}</span>
        {canManage ? (
          <span className="flex items-center gap-2">
            {saved ? <span className="text-xs text-success" role="status">{t("creative.steps.savedStale")}</span> : null}
            <Button type="submit" size="sm" variant="secondary" disabled={busy || text === value || !text.trim()}>
              <Check aria-hidden />
              {t("creative.common.save")}
            </Button>
          </span>
        ) : null}
      </div>
      <FormError error={error} />
    </form>
  );
}

export interface SceneDraft {
  id?: string;
  title: string;
  shot: string;
  narration: string;
  onScreenText: string | null;
  seconds: number;
  media: "image" | "video";
  previewUrl?: string | null;
  isVideo?: boolean;
  status?: string;
  error?: string | null;
}

/** Storyboard editor: edit, add, remove and reorder scenes; save replaces the storyboard. */
export function StoryboardEditor({ base, projectId, scenes: initial, canManage, locked }: { base: string; projectId: string; scenes: SceneDraft[]; canManage: boolean; locked: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [scenes, setScenes] = useState<SceneDraft[]>(initial);
  const [dirty, setDirty] = useState(false);
  const update = (i: number, patch: Partial<SceneDraft>) => {
    setDirty(true);
    setScenes((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const move = (i: number, d: -1 | 1) => {
    setDirty(true);
    setScenes((s) => {
      const n = [...s];
      const j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  };
  const total = scenes.reduce((a, s) => a + (Number(s.seconds) || 0), 0);
  const editable = canManage && !locked;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("creative.storyboard.summary", { count: scenes.length, seconds: Math.round(total) })}</span>
        {locked ? <span>{t("creative.storyboard.locked")}</span> : null}
      </div>
      <ol className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {scenes.map((s, i) => (
          <li key={s.id ?? `new-${i}`} className="grid gap-2 rounded-lg border bg-surface p-3">
            <div className="relative aspect-video overflow-hidden rounded-md bg-muted">
              {s.previewUrl ? (
                s.isVideo ? (
                  <video src={s.previewUrl} className="size-full object-cover" muted loop playsInline controls preload="metadata" aria-label={s.title} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                  <img src={s.previewUrl} alt={s.title} className="size-full object-cover" loading="lazy" />
                )
              ) : (
                <div className="grid size-full place-items-center p-3 text-center text-xs text-muted-foreground">{s.status === "GENERATING" ? t("creative.storyboard.generating") : s.status === "FAILED" ? (s.error ?? t("creative.storyboard.failed")) : t("creative.storyboard.noMedia")}</div>
              )}
              <span className="absolute start-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                {i + 1} · {s.seconds}s
              </span>
            </div>
            <Input aria-label={t("creative.storyboard.sceneTitle")} value={s.title} readOnly={!editable} maxLength={120} onChange={(e) => update(i, { title: e.target.value })} />
            <Textarea aria-label={t("creative.storyboard.shot")} rows={3} value={s.shot} readOnly={!editable} maxLength={1000} onChange={(e) => update(i, { shot: e.target.value })} placeholder={t("creative.storyboard.shot")} />
            <Textarea aria-label={t("creative.storyboard.narration")} rows={2} value={s.narration} readOnly={!editable} maxLength={2000} onChange={(e) => update(i, { narration: e.target.value })} placeholder={t("creative.storyboard.narration")} />
            <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
              <Input aria-label={t("creative.storyboard.onScreen")} value={s.onScreenText ?? ""} readOnly={!editable} maxLength={120} onChange={(e) => update(i, { onScreenText: e.target.value || null })} placeholder={t("creative.storyboard.onScreen")} />
              <Input aria-label={t("creative.storyboard.seconds")} type="number" min={1} max={30} step={0.5} value={s.seconds} readOnly={!editable} onChange={(e) => update(i, { seconds: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
              <Select aria-label={t("creative.storyboard.media")} value={s.media} disabled={!editable} onChange={(e) => update(i, { media: e.target.value as "image" | "video" })}>
                <option value="image">{t("creative.projects.media_image")}</option>
                <option value="video">{t("creative.projects.media_video")}</option>
              </Select>
            </div>
            {editable ? (
              <div className="flex justify-end gap-1">
                <Button type="button" size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("creative.storyboard.up")}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label={t("creative.storyboard.down")}>
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={scenes.length <= 1}
                  onClick={() => {
                    setDirty(true);
                    setScenes((x) => x.filter((_, j) => j !== i));
                  }}
                  aria-label={t("creative.storyboard.remove")}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={scenes.length >= 30}
            onClick={() => {
              setDirty(true);
              setScenes((s) => [...s, { title: t("creative.storyboard.newScene"), shot: "", narration: "", onScreenText: null, seconds: 4, media: "image" }]);
            }}
          >
            <Plus aria-hidden />
            {t("creative.storyboard.add")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !dirty || scenes.some((s) => s.shot.trim().length < 3 || !s.title.trim())}
            onClick={() => void run(() => api(`${base}/creative/projects/${projectId}/scenes`, { method: "PUT", body: { scenes: scenes.map(({ id, title, shot, narration, onScreenText, seconds, media }) => ({ id, title, shot, narration, onScreenText, seconds, media })) } }), () => setDirty(false))}
          >
            <Check aria-hidden />
            {t("creative.storyboard.save")}
          </Button>
          {dirty ? <span className="text-xs text-warning">{t("creative.storyboard.unsaved")}</span> : null}
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

interface Track {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  audioUrl: string;
  licenseUrl: string;
  attribution: string;
}

/** Licensed music: search the connected licensed source, or upload with a license confirmation. */
export function MusicPanel({ base, projectId, locale, canManage }: { base: string; projectId: string; locale: string; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ connected: boolean; tracks: Track[] } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [attest, setAttest] = useState(false);
  if (!canManage) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-2">
        <p className="text-sm font-medium">{t("creative.music.searchTitle")}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api<{ connected: boolean; tracks: Track[] }>(`${base}/creative/projects/${projectId}/music?q=${encodeURIComponent(q)}`), setResult);
          }}
        >
          <Input aria-label={t("creative.music.search")} placeholder={t("creative.music.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
          <Button type="submit" size="sm" variant="secondary" disabled={busy}>
            {t("creative.music.search")}
          </Button>
        </form>
        {result && !result.connected ? (
          <Notice tone="info">
            {t("creative.music.notConnected")}
          </Notice>
        ) : null}
        {result?.connected && !result.tracks.length ? <p className="text-xs text-muted-foreground">{t("creative.music.noResults")}</p> : null}
        <ul className="grid gap-2">
          {result?.tracks.map((tr) => (
            <li key={tr.id} className="grid gap-1 rounded-md border p-2 text-xs">
              <span className="font-medium">
                {tr.title} — {tr.artist} · {Math.round(tr.durationSeconds)}s
              </span>
              <audio src={tr.audioUrl} controls preload="none" className="h-8 w-full" />
              <span className="text-muted-foreground">
                <a href={tr.licenseUrl} target="_blank" rel="noreferrer" className="underline">
                  {t("creative.music.license")}
                </a>{" "}
                · {t("creative.music.attributionRequired")}
              </span>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/creative/projects/${projectId}/music`, { body: { source: "jamendo", trackId: tr.id } }))}>
                {t("creative.music.use")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <form
        className="grid content-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return;
          void run(async () => api(`${base}/creative/projects/${projectId}/music`, { body: { source: "upload", name: file.name, mimeType: file.type || "audio/mpeg", dataBase64: await readFile(file), attest: true, licenseNote: note } }));
        }}
      >
        <p className="text-sm font-medium">{t("creative.music.uploadTitle")}</p>
        <Input type="file" accept="audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/ogg" aria-label={t("creative.music.uploadTitle")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Field label={t("creative.music.licenseNote")} htmlFor="mu-note" hint={t("creative.music.licenseHint")}>
          <Input id="mu-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
          {t("creative.music.attest")}
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !file || !attest || note.trim().length < 3 || (file?.size ?? 0) > 20 * 1024 * 1024}>
          <Upload aria-hidden />
          {t("creative.music.upload")}
        </Button>
        <p className="text-[11px] text-muted-foreground">{t("creative.music.never", { locale })}</p>
      </form>
      <div className="md:col-span-2">
        <FormError error={error} />
      </div>
    </div>
  );
}

export function ReviewPanel({ base, projectId }: { base: string; projectId: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="grid gap-2">
      <Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("creative.review.note")} placeholder={t("creative.review.notePlaceholder")} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void run(() => api(`${base}/creative/projects/${projectId}/review`, { body: { decision: "approve", note: note || undefined } }))}>
          <Check aria-hidden />
          {t("creative.review.approve")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !note.trim()} onClick={() => void run(() => api(`${base}/creative/projects/${projectId}/review`, { body: { decision: "changes", note } }))}>
          {t("creative.review.changes")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

export function HandoffForm({ base, projectId, accounts, hasRender, defaultTitle, locale }: { base: string; projectId: string; accounts: { id: string; name: string; provider: string; connected: boolean }[]; hasRender: boolean; defaultTitle: string; locale: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(defaultTitle);
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [media, setMedia] = useState<"render" | "thumbnail">(hasRender ? "render" : "thumbnail");
  const [postId, setPostId] = useState<string | null>(null);
  if (!accounts.length)
    return (
      <Notice tone="info" action={<Link href={`/${locale}/marketing/social`} className="text-sm font-medium text-primary hover:underline">{t("creative.handoff.setupSocial")}</Link>}>
        {t("creative.handoff.noAccounts")}
      </Notice>
    );
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<{ postId: string }>(`${base}/creative/projects/${projectId}/handoff`, { body: { title, text, accountIds: ids, media } }), (r) => setPostId(r.postId));
      }}
    >
      <Field label={t("creative.handoff.postTitle")} htmlFor="ho-title">
        <Input id="ho-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("creative.handoff.text")} htmlFor="ho-text">
        <Textarea id="ho-text" rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">{t("creative.handoff.accounts")}</legend>
        {accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={ids.includes(a.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id)))} />
            {a.name} <Badge tone={a.connected ? "success" : "warning"}>{a.provider}</Badge>
          </label>
        ))}
      </fieldset>
      <Field label={t("creative.handoff.media")} htmlFor="ho-media" hint={hasRender ? undefined : t("creative.handoff.noRender")}>
        <Select id="ho-media" value={media} onChange={(e) => setMedia(e.target.value as "render" | "thumbnail")}>
          <option value="render" disabled={!hasRender}>
            {t("creative.handoff.render")}
          </option>
          <option value="thumbnail">{t("creative.handoff.thumbnail")}</option>
        </Select>
      </Field>
      <FormError error={error} />
      {postId ? (
        <Notice tone="success" action={<Link href={`/${locale}/marketing/social`} className="text-sm font-medium text-primary hover:underline">{t("creative.handoff.open")}</Link>}>
          {t("creative.handoff.done")}
        </Notice>
      ) : null}
      <Button type="submit" disabled={busy || !ids.length || !title.trim()}>
        {t("creative.handoff.submit")}
      </Button>
    </form>
  );
}

export interface ProjectSettings {
  autoAdvance: boolean;
  voiceProvider: string | null;
  voice: string | null;
  voiceStyle: string | null;
  videoProvider: string | null;
  renderProvider: string | null;
  research: boolean;
}

export function ProjectSettingsForm({ base, projectId, value, connected }: { base: string; projectId: string; value: ProjectSettings; connected: string[] }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [f, setF] = useState(value);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => {
    setSaved(false);
    setF((p) => ({ ...p, [k]: v }));
  };
  const label = (p: string) => `${t(`creative.providers.${p}`)}${connected.includes(p) ? "" : ` (${t("creative.providers.notConnected")})`}`;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api(`${base}/creative/projects/${projectId}`, { method: "PATCH", body: { autoAdvance: f.autoAdvance, settings: { voiceProvider: f.voiceProvider, voice: f.voice || null, voiceStyle: f.voiceStyle || null, videoProvider: f.videoProvider, renderProvider: f.renderProvider, research: f.research } } }),
          () => setSaved(true),
        );
      }}
    >
      <Toggle id="ps-auto" checked={f.autoAdvance} onChange={(v) => set("autoAdvance", v)} label={t("creative.projects.autoAdvance")} hint={t("creative.projects.autoAdvanceHint")} />
      <Toggle id="ps-research" checked={f.research} onChange={(v) => set("research", v)} label={t("creative.projects.research")} hint={t("creative.projects.researchHint")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("creative.settings.voiceProvider")} htmlFor="ps-vp">
          <Select id="ps-vp" value={f.voiceProvider ?? ""} onChange={(e) => set("voiceProvider", e.target.value || null)}>
            <option value="">{t("creative.settings.auto")}</option>
            {VOICE_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.settings.voice")} htmlFor="ps-voice" hint={t("creative.settings.voiceHint")}>
          <Input id="ps-voice" list="ps-voices" maxLength={60} value={f.voice ?? ""} onChange={(e) => set("voice", e.target.value || null)} />
          <datalist id="ps-voices">
            {OPENAI_VOICES.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label={t("creative.settings.voiceStyle")} htmlFor="ps-style">
          <Input id="ps-style" maxLength={300} value={f.voiceStyle ?? ""} onChange={(e) => set("voiceStyle", e.target.value || null)} placeholder={t("creative.settings.voiceStylePlaceholder")} />
        </Field>
        <Field label={t("creative.settings.videoProvider")} htmlFor="ps-video">
          <Select id="ps-video" value={f.videoProvider ?? ""} onChange={(e) => set("videoProvider", e.target.value || null)}>
            <option value="">{t("creative.settings.auto")}</option>
            {SCENE_VIDEO_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("creative.settings.renderProvider")} htmlFor="ps-render">
          <Select id="ps-render" value={f.renderProvider ?? ""} onChange={(e) => set("renderProvider", e.target.value || null)}>
            <option value="">{t("creative.settings.auto")}</option>
            {RENDER_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {t("creative.common.save")}
        </Button>
        {saved ? <span className="text-xs text-success" role="status">{t("creative.common.saved")}</span> : null}
      </div>
    </form>
  );
}
