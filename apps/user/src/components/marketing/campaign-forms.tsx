"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

export const CHANNELS = ["email", "linkedin", "x", "instagram", "facebook", "seo", "content", "google_ads", "meta_ads", "events", "referral", "other"] as const;

export interface CampaignValues {
  id?: string;
  name: string;
  code: string;
  objective: string;
  description: string;
  channels: string[];
  budget: string;
  targetLeads: string;
  targetRevenue: string;
  startDate: string;
  endDate: string;
  segmentId: string;
}
export const emptyCampaign: CampaignValues = { name: "", code: "", objective: "", description: "", channels: [], budget: "", targetLeads: "", targetRevenue: "", startDate: "", endDate: "", segmentId: "" };

/** Create or edit a campaign (goals, channels, budget, schedule, audience). */
export function CampaignForm({ base, locale, initial, segments }: { base: string; locale: string; initial?: CampaignValues; segments: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState<CampaignValues>(initial ?? emptyCampaign);
  const { busy, error, run } = useAction();
  const set = (k: keyof CampaignValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const editing = !!initial?.id;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      name: f.name,
      ...(f.code ? { code: f.code } : editing ? {} : { code: "" }),
      objective: f.objective,
      description: f.description,
      channels: f.channels,
      budget: f.budget,
      targetLeads: f.targetLeads === "" ? null : Number(f.targetLeads),
      targetRevenue: f.targetRevenue || null,
      startDate: f.startDate || null,
      endDate: f.endDate || null,
      segmentId: f.segmentId || null,
    };
    void run(
      () => (editing ? api(`${base}/campaigns/${initial!.id}`, { method: "PATCH", body: payload }) : api<{ id: string }>(`${base}/campaigns`, { body: payload })),
      (r) => {
        if (!editing && r && typeof r === "object" && "id" in r) router.push(`/${locale}/marketing/campaigns/${(r as { id: string }).id}`);
      },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t("marketing.campaigns.name")} htmlFor="cmp-name" className="sm:col-span-2">
        <Input id="cmp-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("marketing.campaigns.code")} htmlFor="cmp-code" hint={t("marketing.campaigns.codeHint")}>
        <Input id="cmp-code" value={f.code} maxLength={40} pattern="[A-Za-z0-9_\-]{2,40}" className="font-mono uppercase" onChange={set("code")} />
      </Field>
      <Field label={t("marketing.campaigns.audience")} htmlFor="cmp-seg">
        <Select id="cmp-seg" value={f.segmentId} onChange={set("segmentId")}>
          <option value="">{t("common.none")}</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.campaigns.objective")} htmlFor="cmp-obj" className="sm:col-span-2 lg:col-span-4">
        <Input id="cmp-obj" value={f.objective} maxLength={500} onChange={set("objective")} />
      </Field>
      <Field label={t("marketing.campaigns.budget")} htmlFor="cmp-budget">
        <Input id="cmp-budget" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.budget} onChange={set("budget")} />
      </Field>
      <Field label={t("marketing.campaigns.targetLeads")} htmlFor="cmp-tl">
        <Input id="cmp-tl" type="number" min={0} value={f.targetLeads} onChange={set("targetLeads")} />
      </Field>
      <Field label={t("marketing.campaigns.targetRevenue")} htmlFor="cmp-tr">
        <Input id="cmp-tr" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.targetRevenue} onChange={set("targetRevenue")} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("marketing.campaigns.start")} htmlFor="cmp-start">
          <Input id="cmp-start" type="date" value={f.startDate} onChange={set("startDate")} />
        </Field>
        <Field label={t("marketing.campaigns.end")} htmlFor="cmp-end">
          <Input id="cmp-end" type="date" value={f.endDate} min={f.startDate || undefined} onChange={set("endDate")} />
        </Field>
      </div>
      <fieldset className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
        <legend className="text-sm font-medium">{t("marketing.campaigns.channels")}</legend>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={f.channels.includes(c)}
                onChange={(e) => setF((p) => ({ ...p, channels: e.target.checked ? [...p.channels, c] : p.channels.filter((x) => x !== c) }))}
              />
              {t(`marketing.channels.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t("marketing.campaigns.description")} htmlFor="cmp-desc" className="sm:col-span-2 lg:col-span-4">
        <Textarea id="cmp-desc" rows={3} value={f.description} maxLength={5000} onChange={set("description")} />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          {editing ? <Save aria-hidden /> : <Plus aria-hidden />}
          {editing ? t("common.save") : t("marketing.campaigns.create")}
        </Button>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function SpendForm({ base, campaignId, channels }: { base: string; campaignId: string; channels: string[] }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const empty = { amount: "", channel: channels[0] ?? "other", spentOn: today, note: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-2 border-b p-3 sm:grid-cols-[8rem_10rem_10rem_minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/campaigns/${campaignId}/spend`, { body: f }), () => setF(empty));
      }}
    >
      <Input aria-label={t("marketing.campaigns.amount")} placeholder={t("marketing.campaigns.amount")} inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" required value={f.amount} onChange={set("amount")} />
      <Select aria-label={t("marketing.common.channel")} value={f.channel} onChange={set("channel")}>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {t(`marketing.channels.${c}`)}
          </option>
        ))}
      </Select>
      <Input aria-label={t("marketing.campaigns.spentOn")} type="date" required value={f.spentOn} onChange={set("spentOn")} />
      <Input aria-label={t("marketing.campaigns.note")} placeholder={t("marketing.campaigns.note")} maxLength={500} value={f.note} onChange={set("note")} />
      <Button type="submit" size="sm" className="h-9" disabled={busy || !f.amount}>
        <Plus aria-hidden />
        {t("marketing.campaigns.addSpend")}
      </Button>
      <div className="sm:col-span-5">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Builds UTM-tagged links: utm_campaign is always the campaign code, so form leads attribute automatically. */
export function UtmBuilder({ code, channels }: { code: string; channels: string[] }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [source, setSource] = useState(channels[0] ?? "");
  const [medium, setMedium] = useState("");
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState(false);
  const built = useMemo(() => {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return "";
      u.searchParams.set("utm_campaign", code);
      if (source) u.searchParams.set("utm_source", source);
      else u.searchParams.delete("utm_source");
      if (medium) u.searchParams.set("utm_medium", medium);
      else u.searchParams.delete("utm_medium");
      if (content) u.searchParams.set("utm_content", content);
      else u.searchParams.delete("utm_content");
      return u.toString();
    } catch {
      return "";
    }
  }, [url, source, medium, content, code]);
  return (
    <div className="grid gap-2 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("marketing.utm.url")} htmlFor="utm-url" className="sm:col-span-2" hint={t("marketing.utm.urlHint")}>
          <Input id="utm-url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value.trim())} />
        </Field>
        <Field label={t("marketing.utm.source")} htmlFor="utm-src">
          <Input id="utm-src" list="utm-sources" value={source} maxLength={100} onChange={(e) => setSource(e.target.value)} />
          <datalist id="utm-sources">
            {["linkedin", "x", "facebook", "instagram", "google", "newsletter", "email"].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label={t("marketing.utm.medium")} htmlFor="utm-med">
          <Input id="utm-med" list="utm-mediums" value={medium} maxLength={100} onChange={(e) => setMedium(e.target.value)} />
          <datalist id="utm-mediums">
            {["social", "email", "cpc", "paid", "organic", "referral"].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label={t("marketing.utm.content")} htmlFor="utm-content" className="sm:col-span-2">
          <Input id="utm-content" value={content} maxLength={100} onChange={(e) => setContent(e.target.value)} />
        </Field>
      </div>
      {built ? (
        <div className="flex items-center gap-2 rounded-md border bg-surface-2 p-2">
          <code className="min-w-0 flex-1 break-all text-xs">{built}</code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(built).then(() => setCopied(true));
            }}
          >
            <Copy aria-hidden />
            {copied ? t("marketing.common.copied") : t("marketing.common.copy")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("marketing.utm.empty")}</p>
      )}
    </div>
  );
}
