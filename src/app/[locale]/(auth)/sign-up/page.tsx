import { Suspense } from "react";
import { SignUpForm } from "@/components/auth/auth-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";
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
      <Suspense fallback={<Skeleton className="h-80" />}>
        <Form />
      </Suspense>
    </div>
  );
}
