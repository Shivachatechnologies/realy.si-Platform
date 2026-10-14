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
        <h1 className="text-xl font-semibold tracking-tight">{t("auth.signUpTitle")}</h1>
        <p className="text-muted-foreground">{t("common.promise")}</p>
      </div>
      <OAuthErrorNotice />
      <Suspense fallback={<Skeleton className="h-80" />}>
        <Form />
      </Suspense>
      <div className="grid gap-2">
        <p className="text-center text-xs text-muted-foreground">{t("auth.orContinueWith")}</p>
        <OAuthButtons providers={oauthStatus()} />
      </div>
    </div>
  );
}
