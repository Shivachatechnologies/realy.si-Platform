import { SignInForm } from "@/components/auth/auth-forms";
import { getT } from "@/i18n/server";
import { OAuthButtons, OAuthErrorNotice } from "@/components/auth/oauth-buttons";
import { oauthStatus } from "@/server/modules/auth/oauth";

export default async function SignInPage() {
  const t = await getT();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("auth.signInTitle")}</h1>
        <p className="text-muted-foreground">{t("auth.signInSubtitle")}</p>
      </div>
      <OAuthErrorNotice />
      <SignInForm />
      <div className="grid gap-2">
        <p className="text-center text-xs text-muted-foreground">{t("auth.orContinueWith")}</p>
        <OAuthButtons providers={oauthStatus()} />
      </div>
    </div>
  );
}
