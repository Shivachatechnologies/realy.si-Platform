"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export const BUSINESS_MODELS = [
  "b2b",
  "b2c",
  "b2b2c",
  "marketplace",
  "subscription",
  "ecommerce",
  "services",
  "agency",
  "other",
] as const;
export type BriefMode = "NEW_IDEA" | "EXISTING" | "IMPORT";

export interface BriefValue {
  idea: string;
  name?: string;
  industry?: string;
  countryCode?: string;
  targetMarket?: string;
  targetMarketCodes: string[];
  businessModel?: (typeof BUSINESS_MODELS)[number];
  offering?: string;
  budgetAmount?: number;
  budgetCurrency?: string;
  goals?: string;
  founderPreferences?: string;
  websiteUrl?: string;
  aiFill: boolean;
}

const INDUSTRIES = [
  "software",
  "ecommerce",
  "consulting",
  "health",
  "education",
  "finance",
  "food",
  "travel",
  "media",
  "manufacturing",
  "realEstate",
  "logistics",
] as const;

/** The builder's essential questions. Only the idea (new business) is required; "Let AI fill the rest" lets the AI infer the others. */
export function BriefForm({
  mode,
  countries,
  currencies,
  defaultCurrency,
  defaultCountry,
  submitLabel,
  onSubmit,
}: {
  mode: BriefMode;
  countries: string[];
  currencies: string[];
  defaultCurrency: string;
  defaultCountry?: string | null;
  submitLabel: string;
  onSubmit: (brief: BriefValue) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const existing = mode !== "NEW_IDEA";
  const sorted = useMemo(
    () =>
      countries
        .map((c) => ({ code: c, name: displayName(c, "region", locale) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [countries, locale],
  );
  const [v, setV] = useState<BriefValue>({
    idea: "",
    targetMarketCodes: [],
    aiFill: true,
    countryCode: defaultCountry ?? undefined,
    budgetCurrency: defaultCurrency,
  });
  const [budget, setBudget] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = <K extends keyof BriefValue>(k: K, value: BriefValue[K]) =>
    setV((x) => ({ ...x, [k]: value }));
  const matches = marketQuery.trim()
    ? sorted
        .filter(
          (c) =>
            c.name.toLowerCase().includes(marketQuery.trim().toLowerCase()) &&
            !v.targetMarketCodes.includes(c.code),
        )
        .slice(0, 12)
    : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const amount = budget.trim() ? Number(budget) : undefined;
      const clean = (s?: string) => (s?.trim() ? s.trim() : undefined);
      await onSubmit({
        ...v,
        idea: v.idea.trim(),
        name: clean(v.name),
        industry: clean(v.industry),
        targetMarket: clean(v.targetMarket),
        offering: clean(v.offering),
        goals: clean(v.goals),
        founderPreferences: clean(v.founderPreferences),
        websiteUrl: clean(v.websiteUrl),
        budgetAmount:
          amount !== undefined && Number.isFinite(amount) ? amount : undefined,
      });
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) {
        const f = err.fieldErrors();
        setFields(
          Object.fromEntries(
            Object.entries(f).map(([k, m]) => [k.replace(/^brief\./, ""), m]),
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <Field
        label={existing ? t("builder.brief.describe") : t("builder.brief.idea")}
        htmlFor="b-idea"
        hint={
          existing
            ? t("builder.brief.describeHint")
            : t("builder.brief.ideaHint")
        }
        error={fields.idea}
      >
        <Textarea
          id="b-idea"
          rows={4}
          required={!existing}
          value={v.idea}
          onChange={(e) => set("idea", e.target.value)}
          maxLength={4000}
        />
      </Field>
      {existing ? (
        <Field
          label={t("builder.brief.website")}
          htmlFor="b-web"
          hint={t("builder.brief.websiteHint")}
          error={fields.websiteUrl}
        >
          <Input
            id="b-web"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={v.websiteUrl ?? ""}
            onChange={(e) => set("websiteUrl", e.target.value)}
          />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("builder.brief.name")}
          htmlFor="b-name"
          hint={existing ? undefined : t("builder.brief.nameHint")}
          error={fields.name}
        >
          <Input
            id="b-name"
            value={v.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label={t("builder.brief.industry")} htmlFor="b-industry">
          <Input
            id="b-industry"
            list="b-industries"
            value={v.industry ?? ""}
            onChange={(e) => set("industry", e.target.value)}
            maxLength={120}
          />
          <datalist id="b-industries">
            {INDUSTRIES.map((i) => (
              <option key={i} value={t(`builder.industries.${i}`)} />
            ))}
          </datalist>
        </Field>
        <Field label={t("builder.brief.country")} htmlFor="b-country">
          <Select
            id="b-country"
            value={v.countryCode ?? ""}
            onChange={(e) => set("countryCode", e.target.value || undefined)}
          >
            <option value="">{t("auth.selectCountry")}</option>
            {sorted.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("builder.brief.businessModel")} htmlFor="b-model">
          <Select
            id="b-model"
            value={v.businessModel ?? ""}
            onChange={(e) =>
              set(
                "businessModel",
                (e.target.value || undefined) as BriefValue["businessModel"],
              )
            }
          >
            <option value="">{t("builder.brief.letAiChoose")}</option>
            {BUSINESS_MODELS.map((m) => (
              <option key={m} value={m}>
                {t(`builder.models.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("builder.brief.offering")} htmlFor="b-offering">
        <Textarea
          id="b-offering"
          rows={2}
          value={v.offering ?? ""}
          onChange={(e) => set("offering", e.target.value)}
          maxLength={2000}
        />
      </Field>
      <Field
        label={t("builder.brief.goals")}
        htmlFor="b-goals"
        hint={t("builder.brief.goalsHint")}
      >
        <Textarea
          id="b-goals"
          rows={2}
          value={v.goals ?? ""}
          onChange={(e) => set("goals", e.target.value)}
          maxLength={2000}
        />
      </Field>
      <details className="rounded-md border">
        <summary className="cursor-pointer p-3 text-sm font-medium">
          {t("builder.brief.advanced")}
        </summary>
        <div className="grid gap-5 p-3 pt-0">
          <div className="grid gap-1.5">
            <Field
              label={t("builder.brief.targetMarket")}
              htmlFor="b-market"
              hint={t("builder.brief.targetMarketHint")}
            >
              <Input
                id="b-market"
                value={v.targetMarket ?? ""}
                onChange={(e) => set("targetMarket", e.target.value)}
                maxLength={1000}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5">
              {v.targetMarketCodes.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    set(
                      "targetMarketCodes",
                      v.targetMarketCodes.filter((c) => c !== code),
                    )
                  }
                  className="rounded-full border border-primary bg-accent px-2.5 py-1 text-xs text-accent-foreground"
                  aria-label={t("builder.brief.removeMarket", {
                    name: displayName(code, "region", locale),
                  })}
                >
                  {displayName(code, "region", locale)} ×
                </button>
              ))}
              <Input
                className="h-8 max-w-56"
                value={marketQuery}
                onChange={(e) => setMarketQuery(e.target.value)}
                placeholder={t("builder.brief.addMarket")}
                aria-label={t("builder.brief.addMarket")}
              />
            </div>
            {matches.length ? (
              <div className="flex flex-wrap gap-1.5">
                {matches.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs hover:bg-muted",
                    )}
                    onClick={() => (
                      set(
                        "targetMarketCodes",
                        [...v.targetMarketCodes, c.code].slice(0, 50),
                      ),
                      setMarketQuery("")
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field
              label={t("builder.brief.budget")}
              htmlFor="b-budget"
              hint={t("builder.brief.budgetHint")}
              error={fields.budgetAmount}
            >
              <Input
                id="b-budget"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </Field>
            <Field label={t("onboarding.baseCurrency")} htmlFor="b-currency">
              <Select
                id="b-currency"
                value={v.budgetCurrency ?? defaultCurrency}
                onChange={(e) => set("budgetCurrency", e.target.value)}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label={t("builder.brief.preferences")}
            htmlFor="b-prefs"
            hint={t("builder.brief.preferencesHint")}
          >
            <Textarea
              id="b-prefs"
              rows={2}
              value={v.founderPreferences ?? ""}
              onChange={(e) => set("founderPreferences", e.target.value)}
              maxLength={2000}
            />
          </Field>
        </div>
      </details>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={v.aiFill}
          onChange={(e) => set("aiFill", e.target.checked)}
        />
        <span>
          <span className="font-medium">{t("builder.brief.aiFill")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("builder.brief.aiFillHint")}
          </span>
        </span>
      </label>
      <FormError error={error} />
      <div>
        <Button
          type="submit"
          loading={busy}
          disabled={!existing && v.idea.trim().length < 10}
        >
          <Sparkles aria-hidden />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
