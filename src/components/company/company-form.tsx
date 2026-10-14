"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { api, ApiError, setCookie } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CountryOption } from "@/server/modules/globalization/options";


const DATA_REGIONS = ["US_EAST", "EU_WEST", "ME_CENTRAL", "AP_SOUTH", "AP_SOUTHEAST"] as const;

/**
 * Creates a company (and, during onboarding, its organization first). Incorporation country only
 * *suggests* currency, timezone and data region; once the user edits a field, suggestions stop overwriting it.
 */
export function CompanyForm({
  countries,
  currencies,
  organizationId,
  onDone,
}: {
  countries: CountryOption[];
  currencies: string[];
  organizationId: string | null;
  onDone?: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const sorted = useMemo(
    () => countries.map((c) => ({ ...c, name: displayName(c.code, "region", locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [countries, locale],
  );

  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [incorporation, setIncorporation] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [dataRegion, setDataRegion] = useState<string>("US_EAST");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function onIncorporation(code: string) {
    setIncorporation(code);
    const c = countries.find((x) => x.code === code);
    if (!c) return;
    if (!touched.currency) setCurrency(c.defaultCurrency);
    if (!touched.timezone) setTimezone(c.defaultTimezone);
    if (!touched.dataRegion) setDataRegion(c.dataRegion);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      let orgId = organizationId;
      if (!orgId) {
        const org = await api<{ id: string }>("/api/v1/organizations", { body: { name: orgName, defaultLocale: locale } });
        orgId = org.id;
        setCookie("realy_org", org.id);
      }
      const company = await api<{ id: string }>(`/api/v1/organizations/${orgId}/companies`, {
        body: {
          name,
          incorporationCountryCode: incorporation || undefined,
          operatingCountryCodes: incorporation ? [incorporation] : [],
          targetMarketCodes: targets,
          baseCurrency: currency,
          timezone,
          dataRegion,
          defaultLocale: locale,
        },
      });
      setCookie("realy_company", company.id);
      onDone?.();
      router.push(`/${locale}`);
      router.refresh();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) setFields(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  }

  const suggested = incorporation ? t("onboarding.suggested") : undefined;

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {!organizationId ? (
        <Field label={t("onboarding.orgName")} htmlFor="orgName" hint={t("onboarding.orgNameHint")} error={fields.name}>
          <Input id="orgName" required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </Field>
      ) : null}
      <Field label={t("onboarding.companyName")} htmlFor="companyName" error={organizationId ? fields.name : undefined}>
        <Input id="companyName" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("onboarding.incorporation")} htmlFor="incorporation" hint={t("onboarding.incorporationHint")}>
        <Select id="incorporation" value={incorporation} onChange={(e) => onIncorporation(e.target.value)}>
          <option value="">{t("auth.selectCountry")}</option>
          {sorted.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">{t("onboarding.targetMarkets")}</legend>
        <p className="text-xs text-muted-foreground">{t("onboarding.targetMarketsHint")}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {sorted.map((c) => {
            const on = targets.includes(c.code);
            return (
              <button
                key={c.code}
                type="button"
                aria-pressed={on}
                onClick={() => setTargets((t) => (on ? t.filter((x) => x !== c.code) : [...t, c.code]))}
                className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted")}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("onboarding.baseCurrency")} htmlFor="currency" hint={touched.currency ? undefined : suggested}>
          <Select id="currency" value={currency} onChange={(e) => (setCurrency(e.target.value), setTouched((x) => ({ ...x, currency: true })))}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c} · {displayName(c, "currency", locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("onboarding.timezone")} htmlFor="timezone">
          <Select id="timezone" value={timezone} onChange={(e) => (setTimezone(e.target.value), setTouched((x) => ({ ...x, timezone: true })))}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("onboarding.dataRegion")} htmlFor="dataRegion">
          <Select id="dataRegion" value={dataRegion} onChange={(e) => (setDataRegion(e.target.value), setTouched((x) => ({ ...x, dataRegion: true })))}>
            {DATA_REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(`onboarding.dataRegions.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t("onboarding.dataRegionHint")}</p>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !name || (!organizationId && !orgName)}>
          {busy ? t("common.creating") : t("onboarding.submit")}
        </Button>
      </div>
    </form>
  );
}
