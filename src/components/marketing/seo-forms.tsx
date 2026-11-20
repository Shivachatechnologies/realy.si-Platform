"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;

export function ProjectForm({ base, locale }: { base: string; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ name: "", domain: "", notes: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<{ id: string }>(`${base}/seo/projects`, { body: f }), (r) => router.push(`/${locale}/marketing/seo/${r.id}`));
      }}
    >
      <Field label={t("marketing.seo.projectName")} htmlFor="sp-name">
        <Input id="sp-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("marketing.seo.domain")} htmlFor="sp-domain">
        <Input id="sp-domain" value={f.domain} maxLength={253} required placeholder="example.com" onChange={set("domain")} />
      </Field>
      <Field label={t("marketing.seo.notes")} htmlFor="sp-notes">
        <Input id="sp-notes" value={f.notes} maxLength={5000} onChange={set("notes")} />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy || !f.name.trim() || !f.domain.trim()}>
          <Plus aria-hidden />
          {t("marketing.seo.createProject")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function KeywordForm({ base, projectId }: { base: string; projectId: string }) {
  const t = useT();
  const empty = { keyword: "", searchVolume: "", difficulty: "", intent: "", targetUrl: "", tracked: true };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_minmax(0,1fr)_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            api(`${base}/seo/projects/${projectId}/keywords`, {
              body: {
                keyword: f.keyword,
                searchVolume: f.searchVolume === "" ? null : Number(f.searchVolume),
                difficulty: f.difficulty === "" ? null : Number(f.difficulty),
                intent: f.intent || null,
                targetUrl: f.targetUrl,
                tracked: f.tracked,
              },
            }),
          () => setF(empty),
        );
      }}
    >
      <Input aria-label={t("marketing.seo.keyword")} placeholder={t("marketing.seo.keyword")} value={f.keyword} maxLength={200} required onChange={(e) => setF((p) => ({ ...p, keyword: e.target.value }))} />
      <Input aria-label={t("marketing.seo.volume")} placeholder={t("marketing.seo.volume")} type="number" min={0} value={f.searchVolume} onChange={(e) => setF((p) => ({ ...p, searchVolume: e.target.value }))} />
      <Input aria-label={t("marketing.seo.difficulty")} placeholder={t("marketing.seo.difficulty")} type="number" min={0} max={100} value={f.difficulty} onChange={(e) => setF((p) => ({ ...p, difficulty: e.target.value }))} />
      <Select aria-label={t("marketing.seo.intent")} value={f.intent} onChange={(e) => setF((p) => ({ ...p, intent: e.target.value }))}>
        <option value="">{t("marketing.seo.intent")}</option>
        {INTENTS.map((i) => (
          <option key={i} value={i}>
            {t(`marketing.seo.intents.${i}`)}
          </option>
        ))}
      </Select>
      <Input aria-label={t("marketing.seo.targetUrl")} placeholder={t("marketing.seo.targetUrl")} type="url" value={f.targetUrl} onChange={(e) => setF((p) => ({ ...p, targetUrl: e.target.value }))} />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={f.tracked} onChange={(e) => setF((p) => ({ ...p, tracked: e.target.checked }))} />
        {t("marketing.seo.track")}
      </label>
      <Button type="submit" size="sm" className="h-9" disabled={busy || !f.keyword.trim()}>
        <Plus aria-hidden />
        {t("marketing.seo.addKeyword")}
      </Button>
      <div className="sm:col-span-7">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Inline rank entry for a keyword (manual rank check). */
export function RankForm({ base, keywordId }: { base: string; keywordId: string }) {
  const t = useT();
  const [rank, setRank] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="inline-flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/seo/keywords/${keywordId}/ranks`, { body: { rank: rank === "" || rank === "0" ? null : Number(rank) } }), () => setRank(""));
      }}
    >
      <Input className="h-8 w-20" type="number" min={0} max={1000} value={rank} aria-label={t("marketing.seo.enterRank")} placeholder={t("marketing.seo.rank")} onChange={(e) => setRank(e.target.value)} />
      <Button type="submit" size="sm" variant="secondary" disabled={busy}>
        {t("common.save")}
      </Button>
      <FormError error={error} />
    </form>
  );
}

export function CompetitorForm({ base, projectId }: { base: string; projectId: string }) {
  const t = useT();
  const empty = { domain: "", notes: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 border-b p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/seo/projects/${projectId}/competitors`, { body: f }), () => setF(empty));
      }}
    >
      <Input aria-label={t("marketing.seo.domain")} placeholder="competitor.com" value={f.domain} required maxLength={253} onChange={(e) => setF((p) => ({ ...p, domain: e.target.value }))} />
      <Textarea aria-label={t("marketing.seo.notes")} placeholder={t("marketing.seo.competitorNotes")} rows={2} value={f.notes} maxLength={5000} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.domain.trim()}>
          <Plus aria-hidden />
          {t("marketing.seo.addCompetitor")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function CompetitorNotes({ base, competitorId, notes }: { base: string; competitorId: string; notes: string }) {
  const t = useT();
  const [v, setV] = useState(notes);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/seo/competitors/${competitorId}`, { method: "PATCH", body: { notes: v } }));
      }}
    >
      <Textarea rows={2} value={v} maxLength={5000} aria-label={t("marketing.seo.notes")} onChange={(e) => setV(e.target.value)} />
      {v !== notes ? (
        <div>
          <Button type="submit" size="sm" variant="secondary" disabled={busy}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </form>
  );
}

export function AuditForm({ base, projectId, domain }: { base: string; projectId: string; domain: string }) {
  const t = useT();
  const [url, setUrl] = useState(`https://${domain}/`);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 border-b p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/seo/projects/${projectId}/audits`, { body: { url } }));
      }}
    >
      <div className="flex gap-2">
        <Input type="url" required value={url} maxLength={2000} aria-label={t("marketing.seo.auditUrl")} onChange={(e) => setUrl(e.target.value)} />
        <Button type="submit" size="sm" className="h-9" disabled={busy}>
          <Search aria-hidden />
          {busy ? t("marketing.seo.auditing") : t("marketing.seo.runAudit")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
