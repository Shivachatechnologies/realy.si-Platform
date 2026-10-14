"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { api, setCookie } from "@/lib/api-client";

export function ProfileForm({ user, countryCodes }: { user: { name: string; locale: string; timezone: string; countryCode: string | null }; countryCodes: string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const [v, setV] = useState({ name: user.name, locale: user.locale, timezone: user.timezone, countryCode: user.countryCode ?? "" });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/v1/me", { method: "PATCH", body: { ...v, countryCode: v.countryCode || null } });
      setSaved(true);
      if (v.locale !== locale) {
        setCookie(LOCALE_COOKIE, v.locale);
        router.replace(`/${v.locale}/settings`);
      }
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid max-w-lg gap-4">
      <Field label={t("settings.profile.name")} htmlFor="name">
        <Input id="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label={t("settings.profile.language")} htmlFor="locale">
        <Select id="locale" value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("settings.profile.timezone")} htmlFor="timezone">
        <Select id="timezone" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("settings.profile.country")} htmlFor="country" hint={t("auth.countryHint")}>
        <Select id="country" value={v.countryCode} onChange={(e) => setV({ ...v, countryCode: e.target.value })}>
          <option value="">{t("auth.selectCountry")}</option>
          {countryCodes.map((c) => (
            <option key={c} value={c}>
              {displayName(c, "region", locale)}
            </option>
          ))}
        </Select>
      </Field>
      <FormError error={error} />
      {saved ? <Notice tone="success">{t("settings.profile.saved")}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
