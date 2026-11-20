import { Suspense } from "react";
import { SignUpForm } from "@/components/auth/auth-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";
import { OAuthButtons, OAuthErrorNotice } from "@/components/auth/oauth-buttons";
import { oauthStatus } from "@/server/modules/auth/oauth";
import { listCountries } from "@/server/modules/globalization/service";

async function Form() {
  const countries = await listCountries();
  return <SignUpForm countryCodes={countries.filter((c) => c.status === "ACTIVE").map((c) => c.code)} />;
}

export default async function SignUpPage() {
  const t = await getT();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-display text-display-lg">{t("auth.signUpTitle")}</h1>
        <p className="text-muted-foreground">{t("common.promise")}</p>
      </div>
      <OAuthErrorNotice />
      <Suspense fallback={<Skeleton className="h-80" />}>
        <Form />
      </Suspense>
      <div className="grid gap-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span aria-hidden className="h-px flex-1 bg-border" />
          <span>{t("auth.orContinueWith")}</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
        <OAuthButtons providers={oauthStatus()} />
      </div>
    </div>
  );
}
