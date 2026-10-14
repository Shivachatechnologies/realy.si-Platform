"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName, formatList, formatMoney } from "@/i18n/format";
import { api } from "@/lib/api-client";

interface WireMoney {
  amountMinor: string;
  currency: string;
}

interface QuoteResponse {
  billingCountryCode: string;
  price: { version: number; market: { type: string; code: string } };
  subtotal: WireMoney;
  discount: WireMoney | null;
  total: WireMoney;
  tax: { displayName: string; priceIncludesTax: boolean; calculation: string; estimate: WireMoney | null } | null;
  paymentMethods: string[];
  trialDays: number;
}

export function BillingPanel({
  orgId,
  confirmedCountry,
  countryCodes,
  plans,
  canManage,
  suggestions,
}: {
  orgId: string;
  confirmedCountry: string | null;
  countryCodes: string[];
  plans: { key: string; name: string }[];
  canManage: boolean;
  suggestions: { user: string | null; companies: string[] };
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const name = (c: string) => displayName(c, "region", locale);
  const [country, setCountry] = useState(confirmedCountry ?? suggestions.companies[0] ?? suggestions.user ?? "");
  const [planKey, setPlanKey] = useState(plans[0]?.key ?? "");
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({ planKey, interval, billingCountryCode: country || undefined, couponCode: coupon || undefined });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("settings.billing.countryTitle")} description={t("settings.billing.countryHint")} />
        <CardBody className="grid gap-3">
          {confirmedCountry ? <Notice tone="success">{t("settings.billing.confirmed", { country: name(confirmedCountry) })}</Notice> : null}
          {suggestions.user || suggestions.companies.length ? (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{t("settings.billing.suggestions")}: </span>
              {suggestions.user ? t("settings.billing.suggestionUser", { country: name(suggestions.user) }) : null}
              {suggestions.user && suggestions.companies.length ? " · " : null}
              {suggestions.companies.length ? t("settings.billing.suggestionCompany", { countries: formatList(suggestions.companies.map(name), locale) }) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("settings.billing.countryTitle")} htmlFor="billing-country" className="min-w-56">
              <Select id="billing-country" value={country} onChange={(e) => (setCountry(e.target.value), setQuote(null))}>
                <option value="">{t("auth.selectCountry")}</option>
                {countryCodes.map((c) => (
                  <option key={c} value={c}>
                    {name(c)}
                  </option>
                ))}
              </Select>
            </Field>
            {canManage ? (
              <Button
                variant="secondary"
                disabled={busy || !country || country === confirmedCountry}
                onClick={() =>
                  run(async () => {
                    await api(`/api/v1/organizations/${orgId}/billing-profile`, { method: "PUT", body: { billingCountryCode: country, confirmCountry: true } });
                    router.refresh();
                  })
                }
              >
                {t("settings.billing.confirm")}
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("settings.billing.quote")} />
        <CardBody className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("settings.billing.plan")} htmlFor="plan">
              <Select id="plan" value={planKey} onChange={(e) => (setPlanKey(e.target.value), setQuote(null))}>
                {plans.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="inline-flex rounded-md border p-0.5" role="group">
              {(["MONTH", "YEAR"] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={interval === i}
                  onClick={() => (setInterval(i), setQuote(null))}
                  className={`rounded px-3 py-1.5 text-xs ${interval === i ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >
                  {t(`settings.billing.interval.${i}`)}
                </button>
              ))}
            </div>
            <Field label={t("settings.billing.coupon")} htmlFor="coupon">
              <Input id="coupon" dir="ltr" className="w-36 font-mono uppercase" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
            </Field>
            <Button
              disabled={busy || !country || !planKey}
              onClick={() => run(async () => setQuote(await api<QuoteResponse>(`/api/v1/organizations/${orgId}/checkout/quote`, { body: body() })))}
            >
              {t("settings.billing.getQuote")}
            </Button>
          </div>
          <FormError error={error} />
          {quote ? (
            <div className="grid gap-3 rounded-md border bg-surface-2 p-4">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
                <dt className="text-muted-foreground">{t("settings.billing.subtotal")}</dt>
                <dd className="tabular text-end">{formatMoney(quote.subtotal, locale)}</dd>
                {quote.discount ? (
                  <>
                    <dt className="text-muted-foreground">{t("settings.billing.discount")}</dt>
                    <dd className="tabular text-end text-success">−{formatMoney(quote.discount, locale)}</dd>
                  </>
                ) : null}
                <dt className="font-medium">{t("settings.billing.total")}</dt>
                <dd className="tabular text-end text-base font-semibold">
                  {formatMoney(quote.total, locale)} <span className="text-xs font-normal text-muted-foreground">{t(`settings.billing.per.${interval}`)}</span>
                </dd>
              </dl>
              {quote.tax ? (
                <p className="text-xs text-muted-foreground">
                  {quote.tax.priceIncludesTax
                    ? t("settings.billing.taxIncluded", { tax: quote.tax.displayName })
                    : t("settings.billing.taxAtCheckout", { tax: quote.tax.displayName })}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("settings.billing.trial", { days: quote.trialDays })}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.billing.paymentMethods")}: <span className="font-mono">{quote.paymentMethods.join(", ")}</span>
              </p>
              {canManage ? (
                <div>
                  <Button
                    disabled={busy}
                    onClick={() => run(async () => void (await api(`/api/v1/organizations/${orgId}/checkout/session`, { body: body() })))}
                  >
                    {t("settings.billing.checkout")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
