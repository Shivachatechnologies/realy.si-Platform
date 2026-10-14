"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { api, ApiError } from "@/lib/api-client";
import { nextFromLocation } from "@/lib/safe-next";
import { useLocationSearch } from "@/lib/use-location-search";

function useSubmit<T>(fn: (values: T) => Promise<void>) {
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (values: T) => {
    setError(null);
    setFields({});
    try {
      await fn(values);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError) setFields(e.fieldErrors());
    }
  };
  return { error, fields, run };
}

export function SignInForm() {
  const { t, locale } = useI18n();
  const search = useLocationSearch();
  const router = useRouter();
  const form = useForm<{ email: string; password: string }>();
  const { error, run } = useSubmit(async (v: { email: string; password: string }) => {
    const r = await api<{ mfaRequired: boolean }>("/api/v1/auth/sign-in", { body: v });
    const next = nextFromLocation(`/${locale}`);
    router.replace(r.mfaRequired ? `/${locale}/mfa?next=${encodeURIComponent(next)}` : next);
    router.refresh();
  });
  return (
    <form onSubmit={form.handleSubmit(run)} className="grid gap-4" noValidate>
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required {...form.register("email", { required: true })} />
      </Field>
      <Field label={t("auth.password")} htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required {...form.register("password", { required: true })} />
      </Field>
      <Link className="-mt-2 justify-self-end text-xs text-primary hover:underline" href={`/${locale}/forgot-password`}>
        {t("auth.forgotPassword")}
      </Link>
      <FormError error={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("common.loading") : t("auth.signIn")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link className="text-primary hover:underline" href={`/${locale}/sign-up${search}`}>
          {t("auth.signUp")}
        </Link>
      </p>
    </form>
  );
}

interface SignUpValues {
  name: string;
  email: string;
  password: string;
  countryCode: string;
}

export function SignUpForm({ countryCodes }: { countryCodes: string[] }) {
  const { t, locale } = useI18n();
  const search = useLocationSearch();
  const router = useRouter();
  const form = useForm<SignUpValues>({ defaultValues: { countryCode: "" } });
  const { error, fields, run } = useSubmit(async (v: SignUpValues) => {
    await api("/api/v1/auth/sign-up", {
      body: {
        ...v,
        countryCode: v.countryCode || undefined,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    router.replace(nextFromLocation(`/${locale}/onboarding`));
    router.refresh();
  });
  const countries = countryCodes
    .map((code) => ({ code, name: displayName(code, "region", locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return (
    <form onSubmit={form.handleSubmit(run)} className="grid gap-4" noValidate>
      <Field label={t("auth.name")} htmlFor="name" error={fields.name}>
        <Input id="name" autoComplete="name" required {...form.register("name", { required: true })} />
      </Field>
      <Field label={t("auth.email")} htmlFor="email" error={fields.email}>
        <Input id="email" type="email" autoComplete="email" required {...form.register("email", { required: true })} />
      </Field>
      <Field label={t("auth.password")} htmlFor="password" hint={t("auth.passwordHint")} error={fields.password}>
        <Input id="password" type="password" autoComplete="new-password" minLength={12} required {...form.register("password", { required: true })} />
      </Field>
      <Field label={t("auth.country")} htmlFor="countryCode" hint={t("auth.countryHint")}>
        <Select id="countryCode" {...form.register("countryCode")}>
          <option value="">{t("auth.selectCountry")}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <FormError error={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("common.creating") : t("auth.signUp")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <Link className="text-primary hover:underline" href={`/${locale}/sign-in${search}`}>
          {t("auth.signIn")}
        </Link>
      </p>
    </form>
  );
}

export function MfaForm() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const form = useForm<{ code: string }>();
  const { error, run } = useSubmit(async (v: { code: string }) => {
    await api("/api/v1/auth/mfa/verify", { body: v });
    router.replace(nextFromLocation(`/${locale}`));
    router.refresh();
  });
  return (
    <form onSubmit={form.handleSubmit(run)} className="grid gap-4" noValidate>
      <Field label={t("auth.mfaCode")} htmlFor="code">
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus dir="ltr" className="font-mono tracking-widest" {...form.register("code", { required: true })} />
      </Field>
      <FormError error={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t("auth.verify")}
      </Button>
    </form>
  );
}
