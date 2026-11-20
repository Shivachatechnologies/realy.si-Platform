"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { nextFromLocation } from "@/lib/safe-next";

/** Control Center auth forms: sign-in and the MFA step only (accounts are created and recovered in the user app). */
function useSubmit<T>(fn: (values: T) => Promise<void>) {
  const [error, setError] = useState<unknown>(null);
  const run = async (values: T) => {
    setError(null);
    try {
      await fn(values);
    } catch (e) {
      setError(e);
    }
  };
  return { error, run };
}

/** `resetUrl`: password recovery happens in the user app (USER_APP_URL); hidden when that is not configured. */
export function SignInForm({ resetUrl }: { resetUrl: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const form = useForm<{ email: string; password: string }>();
  const { error, run } = useSubmit(async (v: { email: string; password: string }) => {
    const r = await api<{ mfaRequired: boolean }>("/api/v1/auth/sign-in", { body: v });
    const next = nextFromLocation(`/${locale}`);
    router.replace(r.mfaRequired ? `/${locale}/mfa?next=${encodeURIComponent(next)}` : next);
    router.refresh();
  });
  return (
    <form onSubmit={form.handleSubmit(run)} className="grid gap-3.5" noValidate>
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" type="email" autoComplete="username" required {...form.register("email", { required: true })} />
      </Field>
      <Field label={t("auth.password")} htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required {...form.register("password", { required: true })} />
      </Field>
      {resetUrl ? (
        <a className="-mt-1.5 justify-self-end text-xs text-primary hover:underline" href={resetUrl}>
          {t("auth.forgotPassword")}
        </a>
      ) : null}
      <FormError error={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("common.loading") : t("auth.signIn")}
      </Button>
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
    <form onSubmit={form.handleSubmit(run)} className="grid gap-3.5" noValidate>
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
