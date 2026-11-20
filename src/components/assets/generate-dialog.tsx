"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, ImagePlus, Pin, RefreshCw, Shuffle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select, Textarea, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { LoadingSequence } from "@/components/motion/loading-sequence";
import { SuccessBurst } from "@/components/motion/success-burst";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ASPECT_RATIOS, ASSET_SCOPES, STYLE_PRESETS, assetFileUrl, type AspectRatio, type AssetScope, type StylePreset } from "@/server/modules/assets/presets";
import { AssetThumb } from "./asset-thumb";

export interface AssetLite {
  id: string;
  title: string | null;
  prompt: string | null;
  stylePreset: string | null;
  aspectRatio: string;
  scopeType: AssetScope;
  scopeId: string | null;
  pinned: boolean;
}
export type ScopeOptions = Partial<Record<AssetScope, { id: string; name: string }[]>>;

/** Small swatch per style preset so the choice is visual, not a word list. */
const STYLE_SWATCH: Record<StylePreset, string> = {
  cinematic: "linear-gradient(135deg, oklch(0.3 0.08 270), oklch(0.65 0.2 30))",
  editorial: "linear-gradient(135deg, oklch(0.92 0.02 80), oklch(0.6 0.05 60))",
  isometric: "linear-gradient(135deg, oklch(0.85 0.08 200), oklch(0.8 0.1 320))",
  abstract: "conic-gradient(from 90deg, oklch(0.7 0.2 300), oklch(0.75 0.15 200), oklch(0.8 0.17 80), oklch(0.7 0.2 300))",
  blueprint: "repeating-linear-gradient(0deg, oklch(0.3 0.08 250) 0 6px, oklch(0.6 0.12 220) 6px 7px)",
  product: "radial-gradient(circle at 40% 35%, oklch(0.98 0 0), oklch(0.8 0.01 260))",
  illustration: "linear-gradient(135deg, oklch(0.8 0.17 140) 50%, oklch(0.75 0.18 30) 50%)",
  portrait: "radial-gradient(circle at 50% 40%, oklch(0.8 0.08 50) 30%, oklch(0.35 0.1 280) 70%)",
};
const ASPECT_BOX: Record<AspectRatio, string> = { "3:2": "h-4 w-6", "1:1": "h-5 w-5", "2:3": "h-6 w-4" };

/**
 * "Generate artwork": prompt, style preset, aspect ratio, variations, scope → real images from the connected provider
 * (Integrations image service), saved to the asset library. Results can be downloaded, pinned to their scope,
 * regenerated or varied. Without a connected image provider it explains how to connect one and generates nothing.
 */
export function GenerateArtworkDialog({
  organizationId,
  companyId,
  connected,
  scopes,
  defaultScope,
  parent,
  trigger,
  onCreated,
}: {
  organizationId: string;
  companyId: string;
  /** Connected image providers (openai/stability/replicate). Empty → "connect a provider". */
  connected: string[];
  scopes?: ScopeOptions;
  defaultScope?: { type: AssetScope; id: string | null };
  /** Regenerate/vary this asset (prefills prompt, style, ratio, scope). */
  parent?: AssetLite;
  trigger?: ReactNode;
  onCreated?: (assets: AssetLite[]) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}`;
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(parent?.prompt ?? "");
  const [title, setTitle] = useState(parent?.title ?? "");
  const [style, setStyle] = useState<StylePreset>((parent?.stylePreset as StylePreset) ?? "cinematic");
  const [aspect, setAspect] = useState<AspectRatio>((parent?.aspectRatio as AspectRatio) ?? "3:2");
  const [count, setCount] = useState(parent ? 2 : 1);
  const [scopeType, setScopeType] = useState<AssetScope>(parent?.scopeType ?? defaultScope?.type ?? "BRAND");
  const [scopeId, setScopeId] = useState<string | null>(parent?.scopeId ?? defaultScope?.id ?? null);
  const [options, setOptions] = useState<ScopeOptions | null>(scopes ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [results, setResults] = useState<AssetLite[]>([]);
  const [lastParent, setLastParent] = useState<string | null>(parent?.id ?? null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!open || options) return;
    let live = true;
    api<{ data: ScopeOptions }>(`${base}/assets/scopes`).then(
      (r) => live && setOptions(r.data),
      () => live && setOptions({}),
    );
    return () => {
      live = false;
    };
  }, [open, options, base]);

  async function run(parentId: string | null, e?: FormEvent) {
    e?.preventDefault();
    if (prompt.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ assets: AssetLite[] }>(`${base}/assets`, {
        body: { prompt: prompt.trim(), stylePreset: style, aspectRatio: aspect, count, title: title.trim() || undefined, scopeType, scopeId: scopeType === "BRAND" ? null : scopeId, parentId: parentId ?? undefined },
      });
      setResults(r.assets);
      setLastParent(parentId);
      setBurst(true);
      onCreated?.(r.assets);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function pin(a: AssetLite) {
    try {
      await api(`${base}/assets/${a.id}`, { method: "PATCH", body: { pinned: true } });
      setSavedId(a.id);
      router.refresh();
    } catch (err) {
      setError(err);
    }
  }

  const list = scopeType === "BRAND" ? [] : (options?.[scopeType] ?? []);
  const providerDetail = error instanceof ApiError && typeof error.details?.providerError === "string" ? error.details.providerError : null;

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? null : setOpen(o))}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="luminous" magnetic>
            <Sparkles aria-hidden />
            {t("assets.generate")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={parent ? t("assets.dialog.varyTitle") : t("assets.dialog.title")} description={t("assets.dialog.description")} closeLabel={t("common.close")} className="max-w-2xl">
        {connected.length === 0 ? (
          <Notice
            tone="warning"
            title={t("assets.notConnected.title")}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href={`/${locale}/integrations`}>{t("assets.notConnected.action")}</Link>
              </Button>
            }
          >
            {t("assets.notConnected.body")}
          </Notice>
        ) : null}

        {busy ? (
          <LoadingSequence className="py-6" title={t("assets.dialog.generating")} steps={[t("assets.dialog.steps.compose"), t("assets.dialog.steps.provider", { count }), t("assets.dialog.steps.store")]} />
        ) : results.length ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3">
              <SuccessBurst active={burst} size={44} label={t("assets.dialog.done", { count: results.length })} onDone={() => setBurst(false)} />
              <p className="text-sm font-medium">{t("assets.dialog.done", { count: results.length })}</p>
            </div>
            <ul className={cn("grid gap-3", results.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {results.map((a) => (
                <li key={a.id} className="grid gap-2">
                  <AssetThumb src={assetFileUrl(organizationId, companyId, a.id)} alt={a.title ?? a.prompt ?? ""} ratio={a.aspectRatio} />
                  <div className="flex flex-wrap gap-1.5">
                    <Button asChild size="sm" variant="secondary">
                      <a href={assetFileUrl(organizationId, companyId, a.id, { download: true })}>
                        <Download aria-hidden />
                        {t("assets.dialog.download")}
                      </a>
                    </Button>
                    <Button size="sm" variant={savedId === a.id ? "soft" : "secondary"} onClick={() => pin(a)} disabled={savedId === a.id}>
                      <Pin aria-hidden />
                      {savedId === a.id ? t("assets.dialog.saved") : t("assets.dialog.saveToScope")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(a.id)}>
                      <Shuffle aria-hidden />
                      {t("assets.dialog.vary")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setResults([])}>
                {t("assets.dialog.newPrompt")}
              </Button>
              <Button onClick={() => run(lastParent)}>
                <RefreshCw aria-hidden />
                {t("assets.dialog.regenerate")}
              </Button>
            </div>
            <FormError error={error} />
          </div>
        ) : (
          <form onSubmit={(e) => run(parent?.id ?? null, e)} className="grid gap-4">
            <Field label={t("assets.dialog.prompt")} htmlFor="art-prompt" hint={t("assets.dialog.promptHint")}>
              <Textarea id="art-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("assets.dialog.promptPlaceholder")} maxLength={1500} rows={3} required />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-[13px] font-medium">{t("assets.dialog.style")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STYLE_PRESETS.map((s) => (
                  <label key={s} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs transition-colors hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2", style === s && "font-medium")}>
                    <input type="radio" name="style" value={s} checked={style === s} onChange={() => setStyle(s)} className="sr-only" />
                    <span aria-hidden className="size-6 shrink-0 rounded-md" style={{ background: STYLE_SWATCH[s] }} />
                    {t(`assets.styles.${s}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">{t("assets.dialog.aspect")}</legend>
                <div className="flex gap-2">
                  {ASPECT_RATIOS.map((r) => (
                    <label key={r} className="flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2">
                      <input type="radio" name="aspect" value={r} checked={aspect === r} onChange={() => setAspect(r)} className="sr-only" />
                      <span aria-hidden className={cn("rounded-[3px] border-2 border-current opacity-70", ASPECT_BOX[r])} />
                      {t(`assets.aspects.${r === "3:2" ? "landscape" : r === "1:1" ? "square" : "portrait"}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label={t("assets.dialog.count")} htmlFor="art-count">
                <Select id="art-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {t("assets.dialog.countOption", { count: n })}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("assets.dialog.scope")} htmlFor="art-scope">
                <Select
                  id="art-scope"
                  value={scopeType}
                  onChange={(e) => {
                    setScopeType(e.target.value as AssetScope);
                    setScopeId(null);
                  }}
                >
                  {ASSET_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`assets.scopes.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {scopeType !== "BRAND" ? (
                <Field label={t("assets.dialog.scopeRecord")} htmlFor="art-scope-id" hint={list.length ? undefined : t("assets.dialog.scopeEmpty")}>
                  <Select id="art-scope-id" value={scopeId ?? ""} onChange={(e) => setScopeId(e.target.value || null)} required disabled={!list.length}>
                    <option value="">{t("assets.dialog.scopeChoose")}</option>
                    {list.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label={t("assets.dialog.titleLabel")} htmlFor="art-title">
                  <Input id="art-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={t("common.optional")} />
                </Field>
              )}
            </div>
            {error ? (
              <div className="grid gap-1">
                <FormError error={error} />
                {providerDetail ? <p className="font-mono text-[11px] text-muted-foreground">{providerDetail}</p> : null}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{connected.length ? t("assets.connectedVia", { providers: connected.join(", ") }) : null}</p>
              <Button type="submit" variant="luminous" disabled={!connected.length || prompt.trim().length < 3 || (scopeType !== "BRAND" && !scopeId)}>
                <ImagePlus aria-hidden />
                {t("assets.dialog.generate")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
