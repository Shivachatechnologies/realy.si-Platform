"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { localInputToIso } from "./format";
import { useAction } from "./ui";

export const PROVIDERS = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "THREADS", "PINTEREST"] as const;
export const TEXT_LIMITS: Record<string, number> = { LINKEDIN: 3000, X: 280, INSTAGRAM: 2200, FACEBOOK: 63206, YOUTUBE: 5000, TIKTOK: 2200, THREADS: 500, PINTEREST: 500 };
const NEEDS_MEDIA = new Set(["INSTAGRAM", "YOUTUBE", "TIKTOK", "PINTEREST"]);

export interface AccountOption {
  id: string;
  name: string;
  provider: string;
  connected: boolean;
}

export function AccountForm({ base, choices = {} }: { base: string; choices?: Record<string, { id: string; name: string }[]> }) {
  const t = useT();
  const empty = { provider: "LINKEDIN", name: "", handle: "", externalId: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/social/accounts`, { body: f }), () => setF(empty));
      }}
    >
      <Field label={t("marketing.social.provider")} htmlFor="acc-provider">
        <Select id="acc-provider" value={f.provider} onChange={set("provider")}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {t(`marketing.provider.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.social.accountName")} htmlFor="acc-name">
        <Input id="acc-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("marketing.social.handle")} htmlFor="acc-handle">
        <Input id="acc-handle" value={f.handle} maxLength={120} placeholder="@" onChange={set("handle")} />
      </Field>
      {choices[f.provider]?.length ? (
        <Field label={t("marketing.studio.social.subAccount")} htmlFor="acc-ext" hint={t("marketing.studio.social.subAccountHint")}>
          <Select
            id="acc-ext"
            value={f.externalId}
            onChange={(e) => {
              const c = choices[f.provider]!.find((x) => x.id === e.target.value);
              setF((p) => ({ ...p, externalId: e.target.value, name: p.name || c?.name || "" }));
            }}
          >
            <option value="">—</option>
            {choices[f.provider]!.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label={t("marketing.social.externalId")} htmlFor="acc-ext" hint={t(`marketing.social.externalIdHint.${f.provider}`)}>
          <Input id="acc-ext" value={f.externalId} maxLength={200} onChange={set("externalId")} />
        </Field>
      )}
      <div className="sm:col-span-4">
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
          <Plus aria-hidden />
          {t("marketing.social.addAccount")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

interface PostDraft {
  id?: string;
  title: string;
  text: string;
  mediaUrl: string;
  mediaAssetId?: string;
  hashtags?: string;
  campaignId: string;
  targets: { accountId: string; text: string; custom: boolean }[];
}

/** Multi-platform composer: one base text, optional per-platform text, live character limits. */
export function PostComposer({ base, locale, accounts, campaigns, initial, assets = [], hashtagSets = [] }: { base: string; locale: string; accounts: AccountOption[]; campaigns: { id: string; name: string }[]; initial?: PostDraft; assets?: { id: string; name: string; kind: string }[]; hashtagSets?: { id: string; name: string; tags: string[] }[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState<PostDraft>(initial ?? { title: "", text: "", mediaUrl: "", campaignId: "", targets: [] });
  const [when, setWhen] = useState("");
  const { busy, error, run } = useAction();
  const editing = !!initial?.id;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const toggle = (id: string, on: boolean) => setF((p) => ({ ...p, targets: on ? [...p.targets, { accountId: id, text: "", custom: false }] : p.targets.filter((x) => x.accountId !== id) }));
  const setTarget = (id: string, patch: Partial<PostDraft["targets"][number]>) => setF((p) => ({ ...p, targets: p.targets.map((x) => (x.accountId === id ? { ...x, ...patch } : x)) }));
  const payload = (schedule: boolean) => ({
    title: f.title,
    text: f.text,
    mediaUrl: f.mediaUrl,
    mediaAssetId: f.mediaAssetId || null,
    hashtags: (f.hashtags ?? "").split(/[\s,]+/).filter(Boolean),
    campaignId: f.campaignId || null,
    targets: f.targets.map((x) => ({ accountId: x.accountId, text: x.custom ? x.text : null })),
    ...(editing ? {} : { scheduledAt: schedule ? (localInputToIso(when) ?? "") : "" }),
  });
  const save = (schedule: boolean) =>
    run(
      () => (editing ? api(`${base}/social/posts/${initial!.id}`, { method: "PATCH", body: payload(false) }) : api<{ id: string }>(`${base}/social/posts`, { body: payload(schedule) })),
      (r) => {
        if (!editing) router.push(`/${locale}/marketing/social/${(r as { id: string }).id}`);
      },
    );
  if (!accounts.length) return <p className="p-4 text-sm text-muted-foreground">{t("marketing.social.noAccounts")}</p>;
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("marketing.social.postTitle")} htmlFor="post-title" className="sm:col-span-2">
          <Input id="post-title" value={f.title} maxLength={200} required onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
        </Field>
        <Field label={t("marketing.campaigns.campaign")} htmlFor="post-campaign">
          <Select id="post-campaign" value={f.campaignId} onChange={(e) => setF((p) => ({ ...p, campaignId: e.target.value }))}>
            <option value="">{t("common.none")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("marketing.social.text")} htmlFor="post-text" hint={t("marketing.content.charCountPlain", { count: f.text.length })}>
        <Textarea id="post-text" rows={5} value={f.text} maxLength={70_000} onChange={(e) => setF((p) => ({ ...p, text: e.target.value }))} />
      </Field>
      <Field label={t("marketing.social.mediaUrl")} htmlFor="post-media" hint={t("marketing.social.mediaHint")}>
        <Input id="post-media" type="url" placeholder="https://" value={f.mediaUrl} onChange={(e) => setF((p) => ({ ...p, mediaUrl: e.target.value }))} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.studio.social.mediaLibrary")} htmlFor="post-asset" hint={t("marketing.studio.social.mediaLibraryHint")}>
          <Select id="post-asset" value={f.mediaAssetId ?? ""} onChange={(e) => setF((p) => ({ ...p, mediaAssetId: e.target.value }))}>
            <option value="">{t("common.none")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({t(`marketing.studio.creative.kinds.${a.kind}`)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.studio.social.hashtags")} htmlFor="post-tags">
          <div className="grid gap-1">
            <Input id="post-tags" value={f.hashtags ?? ""} placeholder="#launch #news" onChange={(e) => setF((p) => ({ ...p, hashtags: e.target.value }))} />
            {hashtagSets.length ? (
              <div className="flex flex-wrap gap-1">
                {hashtagSets.map((h) => (
                  <button key={h.id} type="button" className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-accent" onClick={() => setF((p) => ({ ...p, hashtags: [...new Set([...(p.hashtags ?? "").split(/[\s,]+/).filter(Boolean), ...h.tags])].join(" ") }))}>
                    + {h.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("marketing.social.publishTo")}</legend>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
              <input type="checkbox" checked={f.targets.some((x) => x.accountId === a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
              {a.name} · {t(`marketing.provider.${a.provider}`)}
              {!a.connected ? <span className="text-warning">({t("common.notConnected")})</span> : null}
            </label>
          ))}
        </div>
        {f.targets.map((x) => {
          const a = byId.get(x.accountId);
          if (!a) return null;
          const text = x.custom ? x.text : f.text;
          const limit = TEXT_LIMITS[a.provider] ?? 3000;
          return (
            <div key={x.accountId} className="grid gap-1 rounded-md border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  {a.name} · {t(`marketing.provider.${a.provider}`)}
                </span>
                <span className={text.length > limit ? "text-danger" : "text-muted-foreground"}>
                  {text.length}/{limit}
                </span>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={x.custom} onChange={(e) => setTarget(x.accountId, { custom: e.target.checked, text: x.text || f.text })} />
                  {t("marketing.social.customText")}
                </label>
              </div>
              {x.custom ? <Textarea rows={3} value={x.text} aria-label={t("marketing.social.customText")} onChange={(e) => setTarget(x.accountId, { text: e.target.value })} /> : null}
              {NEEDS_MEDIA.has(a.provider) && !f.mediaUrl && !f.mediaAssetId ? <p className="text-xs text-warning">{t("marketing.studio.social.needsMedia")}</p> : null}
            </div>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim() || !f.targets.length}>
          <Save aria-hidden />
          {editing ? t("common.save") : t("marketing.social.saveDraft")}
        </Button>
        {!editing ? (
          <>
            <Field label={t("marketing.social.scheduleFor")} htmlFor="post-when">
              <Input id="post-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Button type="button" disabled={busy || !when || !f.title.trim() || !f.targets.length} onClick={() => void save(true)}>
              <Send aria-hidden />
              {t("marketing.social.schedule")}
            </Button>
          </>
        ) : null}
      </div>
      <FormError error={error} />
    </form>
  );
}

export function PostActions({ base, postId, status }: { base: string; postId: string; status: string }) {
  const t = useT();
  const [when, setWhen] = useState("");
  const { busy, error, run } = useAction();
  const act = (body: Record<string, unknown>) => run(() => api(`${base}/social/posts/${postId}/actions`, { body }));
  return (
    <div className="grid gap-2 p-4">
      <div className="flex flex-wrap items-end gap-2">
        {status === "DRAFT" || status === "SCHEDULED" ? (
          <>
            <Field label={t("marketing.social.scheduleFor")} htmlFor="pa-when">
              <Input id="pa-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Button type="button" size="sm" className="h-9" variant="secondary" disabled={busy || !when} onClick={() => void act({ action: "schedule", scheduledAt: localInputToIso(when) })}>
              {t("marketing.social.schedule")}
            </Button>
            <Button type="button" size="sm" className="h-9" disabled={busy} onClick={() => window.confirm(t("marketing.social.confirmPublish")) && void act({ action: "publish_now" })}>
              <Send aria-hidden />
              {t("marketing.social.publishNow")}
            </Button>
          </>
        ) : null}
        {status === "SCHEDULED" ? (
          <Button type="button" size="sm" className="h-9" variant="secondary" disabled={busy} onClick={() => void act({ action: "unschedule" })}>
            {t("marketing.social.unschedule")}
          </Button>
        ) : null}
        {status === "DRAFT" || status === "SCHEDULED" ? (
          <Button type="button" size="sm" className="h-9" variant="ghost" disabled={busy} onClick={() => window.confirm(t("marketing.social.confirmCancel")) && void act({ action: "cancel" })}>
            {t("common.cancel")}
          </Button>
        ) : null}
        {status === "FAILED" || status === "PARTIAL" ? (
          <Button type="button" size="sm" className="h-9" disabled={busy} onClick={() => void act({ action: "retry" })}>
            <RefreshCw aria-hidden />
            {t("marketing.social.retryFailed")}
          </Button>
        ) : null}
        {status === "PUBLISHED" || status === "PARTIAL" ? (
          <Button type="button" size="sm" className="h-9" variant="secondary" disabled={busy} onClick={() => void act({ action: "refresh_metrics" })}>
            <RefreshCw aria-hidden />
            {t("marketing.social.refreshMetrics")}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}
