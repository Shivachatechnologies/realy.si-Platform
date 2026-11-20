"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ImagePlus, Plus, RefreshCw, Send, Sparkles, Upload, Video, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { localInputToIso, splitList } from "./format";
import { useAction } from "./ui";

const PROVIDERS = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "THREADS", "PINTEREST"] as const;
const PRESETS = ["instagram_square", "instagram_portrait", "story_reel", "linkedin_post", "x_post", "facebook_post", "pinterest_pin", "youtube_thumbnail", "blog_featured", "ad_square"] as const;
const STYLES = ["photo", "minimal", "illustration", "bold", "product", "3d", "lifestyle"] as const;

function Submit({ busy, children, icon, disabled }: { busy: boolean; children: React.ReactNode; icon?: React.ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" size="sm" disabled={busy || disabled}>
      {icon}
      {children}
    </Button>
  );
}

// ── Goals ──

export function GoalForm({ base }: { base: string }) {
  const t = useT();
  const [f, setF] = useState(() => ({ name: "", metric: "leads", target: "100", startDate: new Date().toISOString().slice(0, 10), endDate: new Date(new Date().getTime() + 30 * 86_400_000).toISOString().slice(0, 10) }));
  const { busy, error, run } = useAction();
  return (
    <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/goals`, { body: { ...f, target: Number(f.target) } }), () => setF({ ...f, name: "" })))}>
      <Field label={t("marketing.studio.goals.name")} htmlFor="g-name">
        <Input id="g-name" required maxLength={160} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label={t("marketing.studio.goals.metricLabel")} htmlFor="g-metric">
        <Select id="g-metric" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>
          {["leads", "impressions", "engagement", "clicks", "posts", "emails_sent", "spend", "traffic", "customers"].map((m) => (
            <option key={m} value={m}>
              {t(`marketing.studio.goals.metric.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.studio.goals.target")} htmlFor="g-target">
        <Input id="g-target" type="number" min={1} required value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("marketing.common.from")} htmlFor="g-from">
          <Input id="g-from" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label={t("marketing.common.to")} htmlFor="g-to">
          <Input id="g-to" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Submit busy={busy} icon={<Plus aria-hidden />}>{t("marketing.studio.goals.add")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

// ── Autopilot ──

export interface AutopilotDraft {
  id?: string;
  name: string;
  objective: string;
  audience: string;
  regions: string;
  pillars: string;
  cadence: Record<string, number>;
  accountIds: string[];
  timezone: string;
  windows: Record<string, string>;
  autonomy: string;
  approvalRules: Record<string, string>;
  complianceRules: string;
  horizonDays: number;
  minReviewScore: number;
  monthlyBudget: string;
  currency: string;
  useResearch: boolean;
  generateImages: boolean;
}

export function AutopilotForm({ base, accounts, initial, onDone }: { base: string; accounts: { id: string; name: string; provider: string }[]; initial: AutopilotDraft; onDone?: (id: string) => void }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  const providers = [...new Set(accounts.filter((a) => f.accountIds.includes(a.id)).map((a) => a.provider))];
  const submit = () =>
    run(
      async () => {
        const body = {
          name: f.name,
          objective: f.objective,
          audience: f.audience,
          regions: splitList(f.regions),
          pillars: splitList(f.pillars),
          cadence: Object.fromEntries(Object.entries(f.cadence).filter(([k, v]) => v > 0 && providers.includes(k.split(":")[0]!))),
          accountIds: f.accountIds,
          timezone: f.timezone,
          postingWindows: Object.fromEntries(Object.entries(f.windows).map(([k, v]) => [k, splitList(v)]).filter(([, v]) => (v as string[]).length)),
          autonomy: f.autonomy,
          approvalRules: f.approvalRules,
          complianceRules: f.complianceRules.split("\n").map((s) => s.trim()).filter(Boolean),
          horizonDays: f.horizonDays,
          minReviewScore: f.minReviewScore,
          monthlyBudget: f.monthlyBudget,
          currency: f.currency,
          useResearch: f.useResearch,
          generateImages: f.generateImages,
        };
        return f.id ? api(`${base}/autopilots/${f.id}`, { method: "PATCH", body }).then(() => ({ id: f.id! })) : api<{ id: string }>(`${base}/autopilots`, { body });
      },
      (r) => {
        if (onDone) onDone(r.id);
        else if (!f.id) router.push(`./autopilot/${r.id}`);
      },
    );
  const cad = (k: string) => f.cadence[k] ?? 0;
  return (
    <form className="grid gap-4 p-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.studio.autopilot.name")} htmlFor="ap-name">
          <Input id="ap-name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t("marketing.studio.autopilot.objective")} htmlFor="ap-obj" hint={t("marketing.studio.autopilot.objectiveEx")}>
          <Input id="ap-obj" required minLength={3} maxLength={1000} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} />
        </Field>
        <Field label={t("marketing.studio.autopilot.audience")} htmlFor="ap-aud">
          <Textarea id="ap-aud" rows={2} maxLength={2000} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
        </Field>
        <Field label={t("marketing.studio.autopilot.pillars")} htmlFor="ap-pil" hint={t("marketing.common.commaSeparated")}>
          <Textarea id="ap-pil" rows={2} value={f.pillars} onChange={(e) => setF({ ...f, pillars: e.target.value })} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("marketing.studio.autopilot.accounts")}</legend>
        {accounts.length === 0 ? <p className="text-xs text-muted-foreground">{t("marketing.studio.journey.noAccounts")}</p> : null}
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const on = f.accountIds.includes(a.id);
            return (
              <label key={a.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm", on && "border-primary bg-accent")}>
                <input type="checkbox" checked={on} onChange={() => setF({ ...f, accountIds: on ? f.accountIds.filter((x) => x !== a.id) : [...f.accountIds, a.id] })} />
                {a.name} · {t(`marketing.provider.${a.provider}`)}
              </label>
            );
          })}
        </div>
      </fieldset>
      {providers.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t("marketing.studio.journey.howOften")}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {providers.map((p) => (
              <div key={p} className="grid gap-1 rounded-md border p-2 text-sm">
                <span className="font-medium">{t(`marketing.provider.${p}`)}</span>
                <label className="flex items-center justify-between gap-2 text-xs">
                  {t("marketing.studio.autopilot.postsPerDay")}
                  <Input type="number" min={0} max={20} className="w-20" value={cad(p)} onChange={(e) => setF({ ...f, cadence: { ...f.cadence, [p]: Number(e.target.value) } })} />
                </label>
                {["INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"].includes(p) ? (
                  <label className="flex items-center justify-between gap-2 text-xs">
                    {t(p === "YOUTUBE" ? "marketing.studio.autopilot.shortsPerDay" : "marketing.studio.autopilot.reelsPerDay")}
                    <Input type="number" min={0} max={10} className="w-20" value={cad(`${p}:${p === "YOUTUBE" ? "short" : "reel"}`)} onChange={(e) => setF({ ...f, cadence: { ...f.cadence, [`${p}:${p === "YOUTUBE" ? "short" : "reel"}`]: Number(e.target.value) } })} />
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("marketing.studio.journey.approval")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {["DRAFT_ONLY", "REVIEW_REQUIRED", "AUTO_PUBLISH"].map((k) => (
            <label key={k} className={cn("grid cursor-pointer gap-1 rounded-md border p-3 text-sm", f.autonomy === k && "border-primary bg-accent")}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="autonomy" checked={f.autonomy === k} onChange={() => setF({ ...f, autonomy: k })} />
                {t(`marketing.studio.autonomy.${k}`)}
              </span>
              <span className="text-xs text-muted-foreground">{t(`marketing.studio.autonomy.${k}Hint`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("marketing.studio.advanced")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("marketing.studio.autopilot.timezone")} htmlFor="ap-tz">
            <Input id="ap-tz" value={f.timezone} maxLength={64} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
          </Field>
          <Field label={t("marketing.studio.autopilot.regions")} htmlFor="ap-reg" hint={t("marketing.common.commaSeparated")}>
            <Input id="ap-reg" value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} />
          </Field>
          {providers.map((p) => (
            <Field key={p} label={t("marketing.studio.autopilot.windows", { platform: t(`marketing.provider.${p}`) })} htmlFor={`ap-w-${p}`} hint={t("marketing.studio.autopilot.windowsHint")}>
              <Input id={`ap-w-${p}`} value={f.windows[p] ?? ""} placeholder="09:00, 12:30" onChange={(e) => setF({ ...f, windows: { ...f.windows, [p]: e.target.value } })} />
            </Field>
          ))}
          {providers.map((p) => (
            <Field key={`r-${p}`} label={t("marketing.studio.autopilot.rule", { platform: t(`marketing.provider.${p}`) })} htmlFor={`ap-r-${p}`}>
              <Select id={`ap-r-${p}`} value={f.approvalRules[p] ?? ""} onChange={(e) => setF({ ...f, approvalRules: Object.fromEntries(Object.entries({ ...f.approvalRules, [p]: e.target.value }).filter(([, v]) => v)) })}>
                <option value="">{t("marketing.studio.autopilot.ruleDefault")}</option>
                <option value="review">{t("marketing.studio.autopilot.ruleReview")}</option>
                <option value="auto">{t("marketing.studio.autopilot.ruleAuto")}</option>
              </Select>
            </Field>
          ))}
          <Field label={t("marketing.studio.autopilot.videoRule")} htmlFor="ap-rv">
            <Select id="ap-rv" value={f.approvalRules.video ?? ""} onChange={(e) => setF({ ...f, approvalRules: Object.fromEntries(Object.entries({ ...f.approvalRules, video: e.target.value }).filter(([, v]) => v)) })}>
              <option value="">{t("marketing.studio.autopilot.ruleDefault")}</option>
              <option value="review">{t("marketing.studio.autopilot.ruleReview")}</option>
              <option value="auto">{t("marketing.studio.autopilot.ruleAuto")}</option>
            </Select>
          </Field>
          <Field label={t("marketing.studio.autopilot.compliance")} htmlFor="ap-comp" hint={t("marketing.studio.autopilot.complianceHint")}>
            <Textarea id="ap-comp" rows={3} value={f.complianceRules} onChange={(e) => setF({ ...f, complianceRules: e.target.value })} />
          </Field>
          <Field label={t("marketing.studio.autopilot.horizon")} htmlFor="ap-h">
            <Input id="ap-h" type="number" min={1} max={14} value={f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: Number(e.target.value) })} />
          </Field>
          <Field label={t("marketing.studio.autopilot.minScore")} htmlFor="ap-ms">
            <Input id="ap-ms" type="number" min={0} max={100} value={f.minReviewScore} onChange={(e) => setF({ ...f, minReviewScore: Number(e.target.value) })} />
          </Field>
          <Field label={t("marketing.studio.autopilot.budget")} htmlFor="ap-b" hint={t("marketing.studio.autopilot.budgetHint")}>
            <div className="flex gap-2">
              <Input id="ap-b" inputMode="decimal" value={f.monthlyBudget} placeholder="0" onChange={(e) => setF({ ...f, monthlyBudget: e.target.value })} />
              <Input className="w-20" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} aria-label={t("marketing.studio.autopilot.currency")} />
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.useResearch} onChange={(e) => setF({ ...f, useResearch: e.target.checked })} />
            {t("marketing.studio.autopilot.useResearch")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.generateImages} onChange={(e) => setF({ ...f, generateImages: e.target.checked })} />
            {t("marketing.studio.autopilot.generateImages")}
          </label>
        </div>
      </details>
      <div>
        <Submit busy={busy} icon={<Sparkles aria-hidden />}>{f.id ? t("common.save") : t("marketing.studio.autopilot.create")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Edit an autopilot item's copy (sends it back through AI review). */
export function ItemEditor({ base, item }: { base: string; item: { id: string; copy: string | null; hashtags: string[]; cta: string | null } }) {
  const t = useT();
  const [copy, setCopy] = useState(item.copy ?? "");
  const [tags, setTags] = useState(item.hashtags.join(", "));
  const [cta, setCta] = useState(item.cta ?? "");
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/autopilot-items/${item.id}/actions`, { body: { action: "edit", copy, hashtags: splitList(tags), cta } })))}>
      <Textarea rows={6} value={copy} maxLength={70_000} onChange={(e) => setCopy(e.target.value)} aria-label={t("marketing.studio.item.copy")} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} aria-label={t("marketing.studio.item.hashtags")} placeholder="#hashtag" />
        <Input value={cta} onChange={(e) => setCta(e.target.value)} aria-label={t("marketing.studio.item.cta")} placeholder={t("marketing.studio.item.cta")} />
      </div>
      <div>
        <Submit busy={busy} disabled={!copy.trim()}>{t("marketing.studio.item.saveReview")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

// ── Creative Studio ──

export function CreativeGenerator({ base, campaigns, connected, initialPrompt, parentId }: { base: string; campaigns: { id: string; name: string }[]; connected: string | null; initialPrompt?: string; parentId?: string }) {
  const t = useT();
  const [f, setF] = useState({ prompt: initialPrompt ?? "", preset: "instagram_square", style: "photo", variations: 2, campaignId: "", headline: "", useBrand: true });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          api(`${base}/assets/generate`, {
            body: { prompt: f.prompt, preset: f.preset, style: f.style, variations: f.variations, campaignId: f.campaignId, useBrand: f.useBrand, parentId, ...(f.headline ? { overlay: { headline: f.headline, position: "top" } } : {}) },
          }),
        );
      }}
    >
      <Field label={t("marketing.studio.creative.prompt")} htmlFor="cg-prompt" hint={t("marketing.studio.creative.promptEx")}>
        <Textarea id="cg-prompt" rows={3} required minLength={3} maxLength={3000} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("marketing.studio.creative.style")} htmlFor="cg-style">
          <Select id="cg-style" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })}>
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.studio.creative.styles.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.studio.creative.size")} htmlFor="cg-size">
          <Select id="cg-size" value={f.preset} onChange={(e) => setF({ ...f, preset: e.target.value })}>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`marketing.studio.creative.presets.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.studio.creative.variations")} htmlFor="cg-var">
          <Select id="cg-var" value={f.variations} onChange={(e) => setF({ ...f, variations: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.campaigns.campaign")} htmlFor="cg-camp">
          <Select id="cg-camp" value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
            <option value="">—</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.studio.creative.overlay")} htmlFor="cg-ov" hint={t("marketing.studio.creative.overlayHint")}>
          <Input id="cg-ov" maxLength={120} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.useBrand} onChange={(e) => setF({ ...f, useBrand: e.target.checked })} />
          {t("marketing.studio.creative.useBrand")}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Submit busy={busy} disabled={!connected} icon={<Wand2 aria-hidden />}>
          {busy ? t("marketing.studio.creative.generating") : t("marketing.studio.creative.generate")}
        </Submit>
        <span className="text-xs text-muted-foreground">{connected ? t("marketing.studio.creative.with", { provider: connected }) : t("marketing.studio.creative.notConnected")}</span>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function VideoForm({ base, images, connected, campaigns }: { base: string; images: { id: string; name: string }[]; connected: string | null; campaigns: { id: string; name: string }[] }) {
  const t = useT();
  const [f, setF] = useState({ prompt: "", imageAssetId: "", vertical: true, campaignId: "" });
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/assets/video`, { body: { prompt: f.prompt, vertical: f.vertical, campaignId: f.campaignId, ...(f.imageAssetId ? { imageAssetId: f.imageAssetId } : {}) } })))}>
      <Field label={t("marketing.studio.creative.videoPrompt")} htmlFor="vg-prompt">
        <Textarea id="vg-prompt" rows={2} required minLength={3} maxLength={2000} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("marketing.studio.creative.startImage")} htmlFor="vg-img">
          <Select id="vg-img" value={f.imageAssetId} onChange={(e) => setF({ ...f, imageAssetId: e.target.value })}>
            <option value="">—</option>
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.studio.creative.format")} htmlFor="vg-fmt">
          <Select id="vg-fmt" value={f.vertical ? "v" : "h"} onChange={(e) => setF({ ...f, vertical: e.target.value === "v" })}>
            <option value="v">{t("marketing.studio.creative.vertical")}</option>
            <option value="h">{t("marketing.studio.creative.horizontal")}</option>
          </Select>
        </Field>
        <Field label={t("marketing.campaigns.campaign")} htmlFor="vg-camp">
          <Select id="vg-camp" value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
            <option value="">—</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Submit busy={busy} disabled={!connected} icon={<Video aria-hidden />}>{t("marketing.studio.creative.makeVideo")}</Submit>
        <span className="text-xs text-muted-foreground">{connected ? t("marketing.studio.creative.with", { provider: connected }) : t("marketing.studio.creative.videoNotConnected")}</span>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function UploadForm({ base }: { base: string }) {
  const t = useT();
  const { busy, error, run, setError } = useAction();
  const [kind, setKind] = useState("IMAGE");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) return setError(new Error(t("marketing.studio.creative.tooLarge")));
        const reader = new FileReader();
        reader.onload = () => void run(() => api(`${base}/assets`, { body: { name: file.name.slice(0, 200), kind, mimeType: file.type || undefined, dataBase64: String(reader.result) } }), () => (input.value = ""));
        reader.readAsDataURL(file);
      }}
    >
      <Field label={t("marketing.studio.creative.file")} htmlFor="up-file">
        <Input id="up-file" name="file" type="file" accept="image/*,video/*,application/pdf" required />
      </Field>
      <Field label={t("marketing.studio.creative.kind")} htmlFor="up-kind">
        <Select id="up-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {["IMAGE", "VIDEO", "LOGO", "DOCUMENT"].map((k) => (
            <option key={k} value={k}>
              {t(`marketing.studio.creative.kinds.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Submit busy={busy} icon={<Upload aria-hidden />}>{t("marketing.studio.creative.upload")}</Submit>
      <FormError error={error} />
    </form>
  );
}

export function AssetActions({ base, asset, campaigns }: { base: string; asset: { id: string; prompt: string | null; publicUrl: string | null; kind: string; campaignId: string | null; preset: string | null }; campaigns: { id: string; name: string }[] }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {asset.publicUrl ? (
          <a href={asset.publicUrl.includes("?") ? `${asset.publicUrl}&download=1` : asset.publicUrl} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent" download>
            <Download className="size-3" aria-hidden />
            {t("marketing.studio.creative.download")}
          </a>
        ) : null}
        {asset.prompt && asset.kind === "IMAGE" ? (
          <button type="button" disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => void run(() => api(`${base}/assets/generate`, { body: { prompt: asset.prompt, preset: asset.preset ?? "instagram_square", variations: 1, parentId: asset.id } }))}>
            <RefreshCw className="size-3" aria-hidden />
            {t("marketing.studio.creative.regenerate")}
          </button>
        ) : null}
        <Select className="h-7 w-36 text-xs" value={asset.campaignId ?? ""} aria-label={t("marketing.studio.creative.saveTo")} onChange={(e) => void run(() => api(`${base}/assets/${asset.id}`, { method: "PATCH", body: { campaignId: e.target.value } }))}>
          <option value="">{t("marketing.studio.creative.noCampaign")}</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <button type="button" disabled={busy} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" onClick={() => window.confirm(t("marketing.common.confirmArchive")) && void run(() => api(`${base}/assets/${asset.id}`, { method: "DELETE" }))}>
          {t("marketing.common.archive")}
        </button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Use an asset in a new social post. */
export function UseInPost({ base, assetId, accounts, title }: { base: string; assetId: string; accounts: { id: string; name: string; provider: string }[]; title: string }) {
  const t = useT();
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const { busy, error, run } = useAction();
  if (!accounts.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select className="h-7 w-40 text-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t("marketing.social.account")}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {t(`marketing.provider.${a.provider}`)}
          </option>
        ))}
      </Select>
      <button type="button" disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => void run(() => api<{ id: string }>(`${base}/social/posts`, { body: { title: title.slice(0, 200), text: "", mediaAssetId: assetId, targets: [{ accountId }] } }), (p) => router.push(`../marketing/social/${p.id}`))}>
        <ImagePlus className="size-3" aria-hidden />
        {t("marketing.studio.creative.useInPost")}
      </button>
      <FormError error={error} />
    </div>
  );
}

// ── Content factory / publishing ──

export function RepurposeForm({ base, contentId, types }: { base: string; contentId: string; types: readonly string[] }) {
  const t = useT();
  const defaults = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "THREADS", "TIKTOK_SCRIPT", "YOUTUBE_SCRIPT", "CAROUSEL", "BLOG", "NEWSLETTER", "QUOTE", "GRAPHIC_BRIEF"];
  const [sel, setSel] = useState<string[]>(defaults.filter((d) => types.includes(d)));
  const [variations, setVariations] = useState(1);
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/content/${contentId}/repurpose`, { body: { formats: sel, variations } })))}>
      <div className="flex flex-wrap gap-1.5">
        {types.map((ty) => {
          const on = sel.includes(ty);
          return (
            <button key={ty} type="button" aria-pressed={on} onClick={() => setSel(on ? sel.filter((x) => x !== ty) : [...sel, ty])} className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-accent" : "text-muted-foreground")}>
              {t(`marketing.contentType.${ty}`)}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-40" value={variations} onChange={(e) => setVariations(Number(e.target.value))} aria-label={t("marketing.studio.creative.variations")}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {t("marketing.studio.repurpose.variations", { count: n })}
            </option>
          ))}
        </Select>
        <Submit busy={busy} disabled={!sel.length} icon={<Sparkles aria-hidden />}>{t("marketing.studio.repurpose.run")}</Submit>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function PublishForm({ base, contentId, targets }: { base: string; contentId: string; targets: { key: string; connected: boolean }[] }) {
  const t = useT();
  const [target, setTarget] = useState(targets.find((x) => x.connected)?.key ?? "realy");
  const [at, setAt] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/content/${contentId}/publish`, { body: { target, publishAt: localInputToIso(at) ?? "" } })))}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("marketing.studio.publish.target")}>
          {targets.map((x) => (
            <option key={x.key} value={x.key} disabled={!x.connected}>
              {t(`marketing.studio.publish.targets.${x.key}`)}
              {x.connected ? "" : ` (${t("common.notConnected")})`}
            </option>
          ))}
        </Select>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t("marketing.studio.publish.when")} />
      </div>
      <div>
        <Submit busy={busy} icon={<Send aria-hidden />}>{at ? t("marketing.studio.publish.schedule") : t("marketing.studio.publish.now")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

export function TextPrompt({ path, field = "question", placeholder, submit, extra }: { path: string; field?: string; placeholder: string; submit: string; extra?: Record<string, unknown> }) {
  const [v, setV] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(path, { body: { ...extra, [field]: v } }), () => setV("")))}>
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" value={v} maxLength={2000} required placeholder={placeholder} aria-label={placeholder} onChange={(e) => setV(e.target.value)} />
        <Submit busy={busy} disabled={!v.trim()} icon={<Sparkles aria-hidden />}>{submit}</Submit>
      </div>
      <FormError error={error} />
    </form>
  );
}

// ── Community, influencers, ads, email ──

export function ReplyEditor({ base, id, draft, canSend }: { base: string; id: string; draft: string | null; canSend: boolean }) {
  const t = useT();
  const [text, setText] = useState(draft ?? "");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <Textarea rows={2} value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} aria-label={t("marketing.studio.community.reply")} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={() => void run(() => api(`${base}/community/${id}/draft`, { body: { text } }))}>
          {t("marketing.studio.community.saveDraft")}
        </Button>
        {canSend ? (
          <Button type="button" size="sm" disabled={busy || !text.trim()} onClick={() => window.confirm(t("marketing.studio.community.confirmSend")) && void run(() => api(`${base}/community/${id}/reply`, { body: { text } }))}>
            <Send aria-hidden />
            {t("marketing.studio.community.send")}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

export function InfluencerForm({ base, initial }: { base: string; initial?: { id: string; name: string; platform: string; handle: string | null; profileUrl: string | null; email: string | null; followers: number | null; niche: string | null; status: string; notes: string | null; outreachSubject: string | null; outreachDraft: string | null } }) {
  const t = useT();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    platform: initial?.platform ?? "INSTAGRAM",
    handle: initial?.handle ?? "",
    profileUrl: initial?.profileUrl ?? "",
    email: initial?.email ?? "",
    followers: initial?.followers?.toString() ?? "",
    niche: initial?.niche ?? "",
    status: initial?.status ?? "PROSPECT",
    notes: initial?.notes ?? "",
    outreachSubject: initial?.outreachSubject ?? "",
    outreachDraft: initial?.outreachDraft ?? "",
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...f, followers: f.followers ? Number(f.followers) : undefined };
        void run(() => (initial ? api(`${base}/influencers/${initial.id}`, { method: "PATCH", body }) : api(`${base}/influencers`, { body })), () => !initial && setF({ ...f, name: "", handle: "", email: "" }));
      }}
    >
      <Field label={t("marketing.studio.influencers.name")} htmlFor={`if-n-${initial?.id ?? "new"}`}>
        <Input id={`if-n-${initial?.id ?? "new"}`} required maxLength={200} value={f.name} onChange={set("name")} />
      </Field>
      <Field label={t("marketing.social.provider")} htmlFor={`if-p-${initial?.id ?? "new"}`}>
        <Select id={`if-p-${initial?.id ?? "new"}`} value={f.platform} onChange={set("platform")}>
          {[...PROVIDERS, "BLOG", "PODCAST", "OTHER"].map((p) => (
            <option key={p} value={p}>
              {PROVIDERS.includes(p as never) ? t(`marketing.provider.${p}`) : t(`marketing.studio.influencers.platforms.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.social.handle")} htmlFor={`if-h-${initial?.id ?? "new"}`}>
        <Input id={`if-h-${initial?.id ?? "new"}`} maxLength={120} value={f.handle} onChange={set("handle")} />
      </Field>
      <Field label={t("marketing.studio.influencers.email")} htmlFor={`if-e-${initial?.id ?? "new"}`}>
        <Input id={`if-e-${initial?.id ?? "new"}`} type="email" maxLength={320} value={f.email} onChange={set("email")} />
      </Field>
      <Field label={t("marketing.studio.influencers.followers")} htmlFor={`if-f-${initial?.id ?? "new"}`}>
        <Input id={`if-f-${initial?.id ?? "new"}`} type="number" min={0} value={f.followers} onChange={set("followers")} />
      </Field>
      <Field label={t("marketing.studio.influencers.niche")} htmlFor={`if-ni-${initial?.id ?? "new"}`}>
        <Input id={`if-ni-${initial?.id ?? "new"}`} maxLength={200} value={f.niche} onChange={set("niche")} />
      </Field>
      <Field label={t("marketing.studio.influencers.url")} htmlFor={`if-u-${initial?.id ?? "new"}`}>
        <Input id={`if-u-${initial?.id ?? "new"}`} type="url" maxLength={2000} value={f.profileUrl} onChange={set("profileUrl")} />
      </Field>
      <Field label={t("common.status")} htmlFor={`if-s-${initial?.id ?? "new"}`}>
        <Select id={`if-s-${initial?.id ?? "new"}`} value={f.status} onChange={set("status")}>
          {["PROSPECT", "CONTACTED", "NEGOTIATING", "ACTIVE", "DECLINED"].map((s) => (
            <option key={s} value={s}>
              {t(`marketing.studio.influencers.status.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.campaigns.note")} htmlFor={`if-no-${initial?.id ?? "new"}`}>
        <Input id={`if-no-${initial?.id ?? "new"}`} maxLength={5000} value={f.notes} onChange={set("notes")} />
      </Field>
      {initial ? (
        <>
          <Field className="sm:col-span-3" label={t("marketing.studio.influencers.subject")} htmlFor={`if-os-${initial.id}`}>
            <Input id={`if-os-${initial.id}`} maxLength={250} value={f.outreachSubject} onChange={set("outreachSubject")} />
          </Field>
          <Field className="sm:col-span-3" label={t("marketing.studio.influencers.message")} htmlFor={`if-om-${initial.id}`}>
            <Textarea id={`if-om-${initial.id}`} rows={5} maxLength={10_000} value={f.outreachDraft} onChange={set("outreachDraft")} />
          </Field>
        </>
      ) : null}
      <div className="sm:col-span-3">
        <Submit busy={busy} icon={initial ? undefined : <Plus aria-hidden />}>{initial ? t("common.save") : t("marketing.studio.influencers.add")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

export function CapsForm({ base, accountId, daily, monthly }: { base: string; accountId: string; daily: string; monthly: string }) {
  const t = useT();
  const [f, setF] = useState({ dailyCap: daily, monthlyCap: monthly });
  const { busy, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/ads/accounts/${accountId}/caps`, { body: f })))}>
      <Field label={t("marketing.studio.ads.dailyCap")} htmlFor={`cap-d-${accountId}`}>
        <Input id={`cap-d-${accountId}`} className="w-28" inputMode="decimal" required value={f.dailyCap} onChange={(e) => setF({ ...f, dailyCap: e.target.value })} />
      </Field>
      <Field label={t("marketing.studio.ads.monthlyCap")} htmlFor={`cap-m-${accountId}`}>
        <Input id={`cap-m-${accountId}`} className="w-28" inputMode="decimal" required value={f.monthlyCap} onChange={(e) => setF({ ...f, monthlyCap: e.target.value })} />
      </Field>
      <Submit busy={busy}>{t("common.save")}</Submit>
      <FormError error={error} />
    </form>
  );
}

export function AdCampaignForm({ base, accounts }: { base: string; accounts: { id: string; name: string; provider: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ adAccountId: accounts[0]?.id ?? "", name: "", objective: "", dailyBudget: "", audience: "", headline: "", body: "", cta: "", url: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api<{ id: string }>(`${base}/ads/campaigns`, { body: { adAccountId: f.adAccountId, name: f.name, objective: f.objective, dailyBudget: f.dailyBudget, audience: f.audience, ads: f.headline && f.body ? [{ headline: f.headline, body: f.body, cta: f.cta || undefined, url: f.url }] : [] } }),
          (c) => router.push(`./ads/${c.id}`),
        );
      }}
    >
      <Field label={t("marketing.studio.ads.account")} htmlFor="ad-acc">
        <Select id="ad-acc" value={f.adAccountId} onChange={set("adAccountId")}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {t(`marketing.studio.ads.providers.${a.provider}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.studio.ads.name")} htmlFor="ad-name">
        <Input id="ad-name" required maxLength={200} value={f.name} onChange={set("name")} />
      </Field>
      <Field label={t("marketing.studio.ads.objective")} htmlFor="ad-obj" hint={t("marketing.studio.ads.objectiveHint")}>
        <Input id="ad-obj" maxLength={60} value={f.objective} onChange={set("objective")} />
      </Field>
      <Field label={t("marketing.studio.ads.dailyBudget")} htmlFor="ad-budget">
        <Input id="ad-budget" inputMode="decimal" required value={f.dailyBudget} onChange={set("dailyBudget")} />
      </Field>
      <Field className="sm:col-span-2" label={t("marketing.studio.ads.audience")} htmlFor="ad-aud">
        <Textarea id="ad-aud" rows={2} maxLength={2000} value={f.audience} onChange={set("audience")} />
      </Field>
      <Field label={t("marketing.studio.ads.headline")} htmlFor="ad-h">
        <Input id="ad-h" maxLength={150} value={f.headline} onChange={set("headline")} />
      </Field>
      <Field label={t("marketing.studio.ads.cta")} htmlFor="ad-cta">
        <Input id="ad-cta" maxLength={40} value={f.cta} onChange={set("cta")} />
      </Field>
      <Field className="sm:col-span-2" label={t("marketing.studio.ads.body")} htmlFor="ad-body">
        <Textarea id="ad-body" rows={2} maxLength={2000} value={f.body} onChange={set("body")} />
      </Field>
      <Field className="sm:col-span-2" label={t("marketing.studio.ads.url")} htmlFor="ad-url">
        <Input id="ad-url" type="url" maxLength={2000} value={f.url} onChange={set("url")} />
      </Field>
      <div className="sm:col-span-2">
        <Submit busy={busy} disabled={!f.adAccountId} icon={<Plus aria-hidden />}>{t("marketing.studio.ads.createDraft")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

export function BudgetChange({ base, id }: { base: string; id: string }) {
  const t = useT();
  const [v, setV] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/ads/campaigns/${id}/changes`, { body: { action: "budget", dailyBudget: v } })))}>
      <Field label={t("marketing.studio.ads.newBudget")} htmlFor="bc-v">
        <Input id="bc-v" className="w-32" inputMode="decimal" required value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
      <Submit busy={busy}>{t("marketing.studio.ads.requestApproval")}</Submit>
      <FormError error={error} />
    </form>
  );
}

export function VariantForm({ base, emailCampaignId }: { base: string; emailCampaignId: string }) {
  const t = useT();
  const [f, setF] = useState({ label: "B", subject: "", body: "" });
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/email/campaigns/${emailCampaignId}/variants`, { body: f }), () => setF({ label: String.fromCharCode(f.label.charCodeAt(0) + 1), subject: "", body: "" })))}>
      <div className="grid gap-2 sm:grid-cols-[5rem_1fr]">
        <Input value={f.label} maxLength={20} required onChange={(e) => setF({ ...f, label: e.target.value })} aria-label={t("marketing.studio.email.label")} />
        <Input value={f.subject} maxLength={250} required placeholder={t("marketing.email.subject")} onChange={(e) => setF({ ...f, subject: e.target.value })} aria-label={t("marketing.email.subject")} />
      </div>
      <Textarea rows={4} value={f.body} maxLength={50_000} required placeholder={t("marketing.email.body")} onChange={(e) => setF({ ...f, body: e.target.value })} aria-label={t("marketing.email.body")} />
      <div>
        <Submit busy={busy} icon={<Plus aria-hidden />}>{t("marketing.studio.email.addVariant")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

export function AbSettings({ base, id, initial }: { base: string; id: string; initial: { provider: string; abEnabled: boolean; abTestPercent: number; abMetric: string; abWaitHours: number } }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/email/campaigns/${id}`, { method: "PATCH", body: f })))}>
      <Field label={t("marketing.studio.email.provider")} htmlFor="ab-prov">
        <Select id="ab-prov" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
          {["platform", "sendgrid", "mailchimp"].map((p) => (
            <option key={p} value={p}>
              {t(`marketing.studio.email.providers.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={f.abEnabled} onChange={(e) => setF({ ...f, abEnabled: e.target.checked })} />
        {t("marketing.studio.email.abEnabled")}
      </label>
      {f.abEnabled ? (
        <>
          <Field label={t("marketing.studio.email.testPercent")} htmlFor="ab-pct">
            <Input id="ab-pct" type="number" min={5} max={50} value={f.abTestPercent} onChange={(e) => setF({ ...f, abTestPercent: Number(e.target.value) })} />
          </Field>
          <Field label={t("marketing.studio.email.metric")} htmlFor="ab-metric">
            <Select id="ab-metric" value={f.abMetric} onChange={(e) => setF({ ...f, abMetric: e.target.value })}>
              <option value="open">{t("marketing.studio.email.metricOpen")}</option>
              <option value="click">{t("marketing.studio.email.metricClick")}</option>
            </Select>
          </Field>
          <Field label={t("marketing.studio.email.waitHours")} htmlFor="ab-wait">
            <Input id="ab-wait" type="number" min={1} max={72} value={f.abWaitHours} onChange={(e) => setF({ ...f, abWaitHours: Number(e.target.value) })} />
          </Field>
        </>
      ) : null}
      <div className="sm:col-span-2">
        <Submit busy={busy}>{t("common.save")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}

export function SuppressionForm({ base }: { base: string }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form className="flex flex-wrap gap-2 p-3" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/suppressions`, { body: { email, reason: "manual" } }), () => setEmail("")))}>
      <Input className="min-w-0 flex-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t("marketing.studio.email.suppressEmail")} placeholder="name@example.com" />
      <Submit busy={busy} icon={<Plus aria-hidden />}>{t("marketing.studio.email.suppress")}</Submit>
      <FormError error={error} />
    </form>
  );
}

export function HashtagSetForm({ base }: { base: string }) {
  const t = useT();
  const [f, setF] = useState({ name: "", platform: "", tags: "" });
  const { busy, error, run } = useAction();
  return (
    <form className="grid gap-2 p-3" onSubmit={(e) => (e.preventDefault(), void run(() => api(`${base}/hashtag-sets`, { body: { name: f.name, platform: f.platform, tags: f.tags.split(/[\s,]+/).filter(Boolean) } }), () => setF({ name: "", platform: "", tags: "" })))}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input required maxLength={80} value={f.name} placeholder={t("marketing.studio.hashtags.name")} aria-label={t("marketing.studio.hashtags.name")} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} aria-label={t("marketing.social.provider")}>
          <option value="">{t("marketing.studio.hashtags.anyPlatform")}</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {t(`marketing.provider.${p}`)}
            </option>
          ))}
        </Select>
      </div>
      <Input required value={f.tags} placeholder="#launch #saas #growth" aria-label={t("marketing.studio.hashtags.tags")} onChange={(e) => setF({ ...f, tags: e.target.value })} />
      <div>
        <Submit busy={busy} icon={<Plus aria-hidden />}>{t("marketing.studio.hashtags.save")}</Submit>
        <FormError error={error} />
      </div>
    </form>
  );
}
