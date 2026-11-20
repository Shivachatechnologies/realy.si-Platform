import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.ssoLogin.title") };
}

const ERRORS = new Set(["no_connection", "state_mismatch", "provider_error", "not_member", "email_mismatch", "account_disabled", "invalid_email", "rate_limited"]);

/** Enterprise single sign-on: the email's verified domain picks the organization's identity provider. */
export default async function SsoLoginPage({ searchParams }: PageProps<"/[locale]/sso">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const sp = await searchParams;
  const error = typeof sp.error === "string" && ERRORS.has(sp.error) ? sp.error : null;
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("enterprise.ssoLogin.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("enterprise.ssoLogin.subtitle")}</p>
      </div>
      {error ? <Notice tone="danger">{t(`enterprise.ssoLogin.errors.${error}`)}</Notice> : null}
      <form method="get" action="/api/v1/sso/oidc/start" className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <Field label={t("enterprise.ssoLogin.email")} htmlFor="sso-email">
          <Input id="sso-email" name="email" type="email" autoComplete="email" required maxLength={254} dir="ltr" />
        </Field>
        <Button type="submit">{t("enterprise.ssoLogin.continue")}</Button>
      </form>
      <Link href={`/${locale}/sign-in`} className="text-center text-sm text-muted-foreground hover:underline">
        {t("enterprise.ssoLogin.back")}
      </Link>
    </div>
  );
}
