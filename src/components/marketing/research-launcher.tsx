"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Compass, KeyRound, Loader2, Radar, Search, Sparkles, Swords, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Same values as server RESEARCH_KINDS (kept local: client files never import server modules). */
const KINDS = ["MARKET", "COMPETITOR", "AUDIENCE", "TRENDS", "KEYWORDS", "BRAND"] as const;
type Kind = (typeof KINDS)[number];
const ICON: Record<Kind, typeof Compass> = { MARKET: BarChart3, COMPETITOR: Swords, AUDIENCE: Users, TRENDS: Radar, KEYWORDS: KeyRound, BRAND: Search };

/**
 * Start a research report: pick what to research, describe it, and the server queries the company's research provider,
 * saves the sources and hands them to an AI analyst. Shows the real outcome (including "no provider connected").
 */
export function ResearchLauncher({ base, locale, connected, defaultBrand, initialKind }: { base: string; locale: string; connected: boolean; defaultBrand?: string; initialKind?: Kind }) {
  const t = useT();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind ?? "MARKET");
  const [subject, setSubject] = useState(initialKind === "BRAND" ? (defaultBrand ?? "") : "");
  const [region, setRegion] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(`${base}/research`, {
        body: { kind, subject: subject.trim(), region: region.trim(), competitors: competitors.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 8), notes: notes.trim() },
      });
      router.push(`/${locale}/marketing/intelligence/${r.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium">{t("marketing.intelligence.launcher.what")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KINDS.map((k) => {
            const Icon = ICON[k];
            const active = k === kind;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setKind(k);
                  if (k === "BRAND" && !subject && defaultBrand) setSubject(defaultBrand);
                }}
                className={cn("grid min-h-20 gap-1 rounded-lg border p-3 text-start transition", active ? "border-primary bg-accent shadow-elev-1" : "bg-surface hover:bg-muted")}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  {t(`marketing.intelligence.kind.${k}`)}
                </span>
                <span className="text-xs text-muted-foreground">{t(`marketing.intelligence.kindHint.${k}`)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t(`marketing.intelligence.subjectLabel.${kind}`)} htmlFor="research-subject" className="sm:col-span-2">
          <Input id="research-subject" required minLength={2} maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t(`marketing.intelligence.subjectPlaceholder.${kind}`)} />
        </Field>
        <Field label={t("marketing.intelligence.launcher.region")} htmlFor="research-region" hint={t("marketing.intelligence.launcher.optional")}>
          <Input id="research-region" maxLength={80} value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        {kind === "COMPETITOR" ? (
          <Field label={t("marketing.intelligence.launcher.competitors")} htmlFor="research-competitors" hint={t("marketing.common.commaSeparated")}>
            <Input id="research-competitors" value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
          </Field>
        ) : null}
        <Field label={t("marketing.intelligence.launcher.notes")} htmlFor="research-notes" hint={t("marketing.intelligence.launcher.optional")} className="sm:col-span-2">
          <Textarea id="research-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || subject.trim().length < 2}>
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles aria-hidden />}
          {busy ? t("marketing.intelligence.launcher.running") : t("marketing.intelligence.launcher.run")}
        </Button>
        <p className="text-xs text-muted-foreground">{connected ? t("marketing.intelligence.launcher.howConnected") : t("marketing.intelligence.launcher.howNotConnected")}</p>
      </div>
      <FormError error={error} />
    </form>
  );
}
