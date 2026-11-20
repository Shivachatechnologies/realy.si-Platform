"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileUp, Lightbulb, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { AiCore } from "@/components/motion";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { api, setCookie } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DocumentPicker, uploadAll, type FileState } from "./documents";

type Mode = "NEW_IDEA" | "EXISTING" | "IMPORT";
const MODES = [
  { mode: "NEW_IDEA", key: "new", icon: Lightbulb },
  { mode: "EXISTING", key: "existing", icon: Store },
  { mode: "IMPORT", key: "import", icon: FileUp },
] as const;
const INDUSTRIES = ["software", "ecommerce", "consulting", "health", "education", "finance", "food", "travel", "media", "manufacturing", "realEstate", "logistics"] as const;
const MODELS = ["b2b", "b2c", "b2b2c", "marketplace", "subscription", "ecommerce", "services", "agency", "other"] as const;

export interface VisionValue {
  mode?: Mode;
  idea?: string;
  name?: string;
  industry?: string;
  countryCode?: string;
  currency?: string;
  websiteUrl?: string;
  targetMarket?: string;
  businessModel?: string;
  goals?: string;
  budgetAmount?: string;
}

interface Props {
  org: { id: string; name: string };
  draft: VisionValue | null;
  countries: { code: string; defaultCurrency: string; defaultTimezone: string }[];
  currencies: string[];
  userCountry: string | null;
}

/** A line the AI "says" in the conversation (start side, with the core as its avatar). */
function AiLine({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return (
    <div className="flex items-start gap-2.5 animate-fade-in" style={{ animationDelay: `${index * 80}ms` }}>
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-gradient text-primary-foreground shadow-glow">
        <AiCore className="size-7" />
      </span>
      <div className="min-w-0 rounded-2xl rounded-ss-sm border bg-surface/90 px-3.5 py-2.5 text-sm text-pretty shadow-elev-1 backdrop-blur">{children}</div>
    </div>
  );
}

/**
 * Stage 2 — Vision: a conversation instead of a form. The founder says what they want to build (new idea, existing
 * business or documents), describes it in their own words, optionally adds details and documents. Answers are saved
 * server-side as they type; "Start the research" creates the company, its journey run, uploads the documents into
 * Company Brain and starts the real AI research.
 */
export function VisionStage({ org, draft, countries, currencies, userCountry }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const home = countries.find((c) => c.code === userCountry);
  const [v, setV] = useState<VisionValue>({ countryCode: userCountry ?? "", currency: home?.defaultCurrency ?? "", ...draft });
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading" | "starting">("idle");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const set = (k: keyof VisionValue, value: string) => setV((x) => ({ ...x, [k]: value }));
  const sortedCountries = useMemo(() => countries.map((c) => ({ ...c, name: displayName(c.code, "region", locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)), [countries, locale]);

  // Autosave (debounced) so a reload or another device resumes with the same answers.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      setSaved("saving");
      const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== ""));
      api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: "vision", draft: { vision: clean } } }).then(
        () => setSaved("saved"),
        () => setSaved("failed"),
      );
    }, 1200);
    return () => clearTimeout(id);
  }, [v]);

  const idea = (v.idea ?? "").trim();
  const website = (v.websiteUrl ?? "").trim();
  const ready = v.mode === "NEW_IDEA" ? idea.length >= 10 : v.mode === "EXISTING" ? idea.length >= 10 || /^https?:\/\/\S+\.\S+/.test(website) : v.mode === "IMPORT" ? files.length > 0 || idea.length >= 10 : false;
  const websiteValid = !website || /^https?:\/\/\S+\.\S+/.test(website);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setPhase("creating");
      const country = countries.find((c) => c.code === v.countryCode);
      const budget = Number((v.budgetAmount ?? "").replace(",", "."));
      const brief = {
        idea,
        name: v.name?.trim() || undefined,
        industry: v.industry?.trim() || undefined,
        countryCode: v.countryCode || undefined,
        targetMarket: v.targetMarket?.trim() || undefined,
        targetMarketCodes: v.countryCode ? [v.countryCode] : [],
        businessModel: v.businessModel || undefined,
        goals: v.goals?.trim() || undefined,
        websiteUrl: website || undefined,
        ...(v.budgetAmount && Number.isFinite(budget) && budget >= 0 ? { budgetAmount: budget, budgetCurrency: v.currency || country?.defaultCurrency } : {}),
        aiFill: true,
      };
      const hold = files.length > 0;
      const r = await api<{ companyId: string; runId: string; status: string }>(`/api/v1/organizations/${org.id}/onboarding/business`, {
        body: {
          mode: v.mode,
          brief,
          journey: true,
          hold,
          company: {
            name: v.name?.trim() || undefined,
            incorporationCountryCode: v.countryCode || undefined,
            operatingCountryCodes: v.countryCode ? [v.countryCode] : [],
            targetMarketCodes: v.countryCode ? [v.countryCode] : [],
            baseCurrency: v.currency || country?.defaultCurrency || undefined,
            timezone: country?.defaultTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            defaultLocale: locale,
          },
        },
      });
      setCookie("realy_company", r.companyId);
      const base = `/api/v1/organizations/${org.id}/companies/${r.companyId}/builder/runs/${r.runId}`;
      if (hold) {
        setPhase("uploading");
        await uploadAll(base, files, setFiles);
        setPhase("starting");
        await api(`${base}/start`, { body: {} });
      }
      await api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: "intelligence", runId: r.runId, draft: { vision: null } } }).catch(() => undefined);
      router.push(`/${locale}/onboarding?stage=intelligence`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
      setPhase("idle");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-[1.75rem] border bg-surface/50 p-4 shadow-elev-2 backdrop-blur sm:p-6">
        <AiLine>{t("onboarding.journey.vision.ask.mode", { workspace: org.name })}</AiLine>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("onboarding.journey.vision.ask.modeLabel")}>
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={v.mode === m.mode}
              onClick={() => setV((x) => ({ ...x, mode: m.mode }))}
              className={cn(
                "grid min-h-24 gap-1 rounded-2xl border bg-surface p-3 text-start transition-[border-color,box-shadow,background-color] hover:border-primary",
                v.mode === m.mode && "border-primary bg-accent/50 shadow-glow",
              )}
            >
              <m.icon className="size-5 text-primary" aria-hidden />
              <span className="font-medium">{t(`builder.onboarding.business.${m.key}.title`)}</span>
              <span className="text-xs text-muted-foreground">{t(`builder.onboarding.business.${m.key}.description`)}</span>
            </button>
          ))}
        </div>

        {v.mode ? (
          <>
            <AiLine>{t(`onboarding.journey.vision.ask.idea.${v.mode}`)}</AiLine>
            <div className="ms-0 grid gap-2 sm:ms-10">
              <label htmlFor="v-idea" className="sr-only">
                {t("onboarding.journey.vision.ideaLabel")}
              </label>
              <Textarea id="v-idea" rows={5} maxLength={4000} value={v.idea ?? ""} onChange={(e) => set("idea", e.target.value)} placeholder={t(`onboarding.journey.vision.placeholder.${v.mode}`)} className="rounded-2xl text-base" />
              {v.mode !== "NEW_IDEA" ? (
                <Field label={t("builder.brief.website")} htmlFor="v-web" error={websiteValid ? undefined : t("onboarding.journey.vision.websiteInvalid")} hint={t("onboarding.journey.vision.websiteHint")}>
                  <Input id="v-web" type="url" inputMode="url" placeholder="https://" value={v.websiteUrl ?? ""} onChange={(e) => set("websiteUrl", e.target.value)} maxLength={500} />
                </Field>
              ) : null}
            </div>

            <AiLine>{t("onboarding.journey.vision.ask.details")}</AiLine>
            <div className="ms-0 grid gap-3 sm:ms-10 sm:grid-cols-2">
              <Field label={t("onboarding.journey.vision.name")} htmlFor="v-name" hint={t("onboarding.journey.vision.nameHint")}>
                <Input id="v-name" value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={120} />
              </Field>
              <Field label={t("builder.brief.industry")} htmlFor="v-industry">
                <Input id="v-industry" list="v-industries" value={v.industry ?? ""} onChange={(e) => set("industry", e.target.value)} maxLength={120} />
                <datalist id="v-industries">
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={t(`builder.industries.${i}`)} />
                  ))}
                </datalist>
              </Field>
              <Field label={t("onboarding.journey.vision.country")} htmlFor="v-country">
                <Select
                  id="v-country"
                  value={v.countryCode ?? ""}
                  onChange={(e) => {
                    const c = countries.find((x) => x.code === e.target.value);
                    setV((x) => ({ ...x, countryCode: e.target.value, currency: c?.defaultCurrency ?? x.currency }));
                  }}
                >
                  <option value="">{t("auth.selectCountry")}</option>
                  {sortedCountries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("onboarding.baseCurrency")} htmlFor="v-currency">
                <Select id="v-currency" value={v.currency ?? ""} onChange={(e) => set("currency", e.target.value)}>
                  <option value="">—</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("builder.brief.businessModel")} htmlFor="v-model">
                <Select id="v-model" value={v.businessModel ?? ""} onChange={(e) => set("businessModel", e.target.value)}>
                  <option value="">{t("onboarding.journey.vision.letAiChoose")}</option>
                  {MODELS.map((m) => (
                    <option key={m} value={m}>
                      {t(`builder.models.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("onboarding.journey.vision.budget", { currency: v.currency || "—" })} htmlFor="v-budget">
                <Input id="v-budget" inputMode="decimal" value={v.budgetAmount ?? ""} onChange={(e) => set("budgetAmount", e.target.value.replace(/[^\d.,]/g, "").slice(0, 20))} />
              </Field>
              <Field label={t("builder.brief.targetMarket")} htmlFor="v-market" className="sm:col-span-2">
                <Input id="v-market" value={v.targetMarket ?? ""} onChange={(e) => set("targetMarket", e.target.value)} maxLength={1000} />
              </Field>
              <Field label={t("builder.brief.goals")} htmlFor="v-goals" className="sm:col-span-2">
                <Textarea id="v-goals" rows={2} value={v.goals ?? ""} onChange={(e) => set("goals", e.target.value)} maxLength={2000} />
              </Field>
            </div>

            <AiLine>{t("onboarding.journey.vision.ask.docs")}</AiLine>
            <div className="ms-0 sm:ms-10">
              <DocumentPicker files={files} onChange={setFiles} disabled={busy} />
            </div>
          </>
        ) : null}
      </div>

      <div className="sticky bottom-3 z-10 grid gap-2 rounded-2xl border bg-surface/90 p-3 shadow-elev-3 backdrop-blur sm:flex sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {phase !== "idle" ? t(`onboarding.journey.vision.phase.${phase}`) : saved === "saving" ? t("onboarding.journey.saving") : saved === "saved" ? t("onboarding.journey.saved") : saved === "failed" ? t("onboarding.journey.saveFailed") : t("onboarding.journey.vision.readyHint")}
        </p>
        <Button size="xl" variant="luminous" magnetic loading={busy} disabled={!ready || !websiteValid} onClick={start}>
          {t("onboarding.journey.vision.start")}
          <ArrowRight aria-hidden className="rtl:rotate-180" />
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
