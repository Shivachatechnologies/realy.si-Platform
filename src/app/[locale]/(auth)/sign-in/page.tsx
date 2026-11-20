import { SignInForm } from "@/components/auth/auth-forms";
import Link from "next/link";
import { getLocale, getT } from "@/i18n/server";
import { OAuthButtons, OAuthErrorNotice } from "@/components/auth/oauth-buttons";
import { oauthStatus } from "@/server/modules/auth/oauth";

export default async function SignInPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-display text-display-lg">{t("auth.signInTitle")}</h1>
        <p className="text-muted-foreground">{t("auth.signInSubtitle")}</p>
      </div>
      <OAuthErrorNotice />
      <SignInForm />
      <div className="grid gap-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span aria-hidden className="h-px flex-1 bg-border" />
          <span>{t("auth.orContinueWith")}</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
        <OAuthButtons providers={oauthStatus()} />
        <Link href={`/${locale}/sso`} className="text-center text-xs text-primary hover:underline">
          {t("auth.ssoSignIn")}
        </Link>
      </div>
    </div>
  );
}
