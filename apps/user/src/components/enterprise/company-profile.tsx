"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { api, setCookie } from "@/lib/api-client";
import { useAction } from "./use-action";

export interface ProfileValue {
  name: string;
  legalName: string;
  industry: string;
  website: string;
  logoUrl: string;
  description: string;
  fiscalYearStartMonth: number;
  timezone: string;
  baseCurrency: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
  };
}

export function CompanyProfileForm({
  base,
  initial,
  currencies,
  countries,
  canManage,
}: {
  base: string;
  initial: ProfileValue;
  currencies: string[];
  countries: string[];
  canManage: boolean;
}) {
  const { t, locale } = useI18n();
  const [f, setF] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const currencyChanged = f.baseCurrency !== initial.baseCurrency;
  const set = (k: keyof Omit<ProfileValue, "address" | "fiscalYearStartMonth">) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setAddr = (k: keyof ProfileValue["address"]) => (e: { target: { value: string } }) => setF((p) => ({ ...p, address: { ...p.address, [k]: e.target.value } }));
  const monthName = (m: number) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));
  const sortedCountries = useMemo(
    () => countries.map((c) => ({ code: c, name: displayName(c, "region", locale) })).sort((x, y) => x.name.localeCompare(y.name, locale)),
    [countries, locale],
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          () =>
            api(`${base}/enterprise/profile`, {
              method: "PUT",
              body: { ...f, confirmCurrencyChange: confirm },
            }),
          () => setConfirm(false),
        );
      }}
    >
      <fieldset disabled={!canManage} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("enterprise.company.name")} htmlFor="cp-name" error={a.fields.name}>
          <Input id="cp-name" value={f.name} maxLength={120} required onChange={set("name")} />
        </Field>
        <Field label={t("enterprise.company.legalName")} htmlFor="cp-legal" error={a.fields.legalName}>
          <Input id="cp-legal" value={f.legalName} maxLength={200} onChange={set("legalName")} />
        </Field>
        <Field label={t("enterprise.company.industry")} htmlFor="cp-industry">
          <Input id="cp-industry" value={f.industry} maxLength={120} onChange={set("industry")} />
        </Field>
        <Field label={t("enterprise.company.website")} htmlFor="cp-web" error={a.fields.website}>
          <Input id="cp-web" type="url" dir="ltr" value={f.website} onChange={set("website")} placeholder="https://" />
        </Field>
        <Field label={t("enterprise.company.logoUrl")} htmlFor="cp-logo" error={a.fields.logoUrl}>
          <Input id="cp-logo" type="url" dir="ltr" value={f.logoUrl} onChange={set("logoUrl")} />
        </Field>
        <Field label={t("enterprise.company.fiscalYearStart")} htmlFor="cp-fiscal">
          <Select
            id="cp-fiscal"
            value={f.fiscalYearStartMonth}
            onChange={(e) =>
              setF((p) => ({
                ...p,
                fiscalYearStartMonth: Number(e.target.value),
              }))
            }
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("onboarding.timezone")} htmlFor="cp-tz">
          <Select id="cp-tz" value={f.timezone} onChange={set("timezone")}>
            {/* Intl lists legacy zone names (Asia/Calcutta); keep the stored canonical one (Asia/Kolkata) selectable. */}
            {(timezones.includes(f.timezone) ? timezones : [f.timezone, ...timezones]).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("onboarding.baseCurrency")} htmlFor="cp-cur">
          <Select id="cp-cur" value={f.baseCurrency} onChange={set("baseCurrency")}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c} · {displayName(c, "currency", locale)}
              </option>
            ))}
          </Select>
        </Field>
        {currencyChanged ? (
          <div className="grid gap-2 sm:col-span-2">
            <Notice tone="warning">
              {t("enterprise.company.currencyWarning", {
                from: initial.baseCurrency,
                to: f.baseCurrency,
              })}
            </Notice>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              {t("enterprise.company.currencyConfirm")}
            </label>
          </div>
        ) : null}
        <Field label={t("enterprise.company.description")} htmlFor="cp-desc" className="sm:col-span-2">
          <Textarea id="cp-desc" rows={2} maxLength={2000} value={f.description} onChange={set("description")} />
        </Field>
        <fieldset className="grid gap-3 rounded-md border p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">{t("enterprise.company.address")}</legend>
          <Field label={t("enterprise.company.line1")} htmlFor="cp-l1">
            <Input id="cp-l1" value={f.address.line1} maxLength={200} onChange={setAddr("line1")} />
          </Field>
          <Field label={t("enterprise.company.line2")} htmlFor="cp-l2">
            <Input id="cp-l2" value={f.address.line2} maxLength={200} onChange={setAddr("line2")} />
          </Field>
          <Field label={t("enterprise.company.city")} htmlFor="cp-city">
            <Input id="cp-city" value={f.address.city} maxLength={120} onChange={setAddr("city")} />
          </Field>
          <Field label={t("enterprise.company.region")} htmlFor="cp-region">
            <Input id="cp-region" value={f.address.region} maxLength={120} onChange={setAddr("region")} />
          </Field>
          <Field label={t("enterprise.company.postalCode")} htmlFor="cp-postal">
            <Input id="cp-postal" value={f.address.postalCode} maxLength={20} onChange={setAddr("postalCode")} />
          </Field>
          <Field label={t("enterprise.company.country")} htmlFor="cp-country">
            <Select id="cp-country" value={f.address.countryCode} onChange={setAddr("countryCode")}>
              <option value="">{t("auth.selectCountry")}</option>
              {sortedCountries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>
      </fieldset>
      <FormError error={a.error} />
      {a.done ? <Notice tone="success">{t("enterprise.saved")}</Notice> : null}
      {canManage ? (
        <div>
          <Button type="submit" disabled={a.busy || !f.name || (currencyChanged && !confirm)}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function SwitchCompanyButton({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        setCookie("realy_company", companyId);
        router.refresh();
      }}
    >
      {t("enterprise.company.switch")}
    </Button>
  );
}

export function Workspaces({ base, workspaces, canManage }: { base: string; workspaces: { id: string; name: string; projects: number }[]; canManage: boolean }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const a = useAction();
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-md border">
        {workspaces.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            {editing?.id === w.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(
                    () =>
                      api(`${base}/enterprise/workspaces/${w.id}`, {
                        method: "PATCH",
                        body: { name: editing.name },
                      }),
                    () => setEditing(null),
                  );
                }}
              >
                <Input
                  aria-label={t("company.workspaceName")}
                  value={editing.name}
                  maxLength={80}
                  onChange={(e) => setEditing({ id: w.id, name: e.target.value })}
                  className="h-8"
                />
                <Button size="icon" className="size-8" type="submit" aria-label={t("common.save")} disabled={a.busy}>
                  <Check aria-hidden />
                </Button>
                <Button size="icon" className="size-8" type="button" variant="ghost" aria-label={t("common.cancel")} onClick={() => setEditing(null)}>
                  <X aria-hidden />
                </Button>
              </form>
            ) : (
              <>
                <span className="flex-1 font-medium">{w.name}</span>
                <span className="text-xs text-muted-foreground">{t("enterprise.company.projectCount", { count: w.projects })}</span>
                {canManage ? (
                  <>
                    <Button size="icon" variant="ghost" className="size-8" aria-label={t("enterprise.company.rename")} onClick={() => setEditing({ id: w.id, name: w.name })}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={t("enterprise.company.deleteWorkspace")}
                      disabled={a.busy || w.projects > 0 || workspaces.length <= 1}
                      title={w.projects > 0 ? t("enterprise.company.workspaceNotEmpty") : undefined}
                      onClick={() =>
                        void a.run(() =>
                          api(`${base}/enterprise/workspaces/${w.id}`, {
                            method: "DELETE",
                          }),
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(
              () => api(`${base}/enterprise/workspaces`, { body: { name } }),
              () => setName(""),
            );
          }}
        >
          <Input
            aria-label={t("company.workspaceName")}
            placeholder={t("company.workspaceName")}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <Button type="submit" variant="secondary" disabled={a.busy || !name.trim()}>
            <Plus aria-hidden />
            {t("company.newWorkspace")}
          </Button>
        </form>
      ) : null}
      <FormError error={a.error} />
    </div>
  );
}
