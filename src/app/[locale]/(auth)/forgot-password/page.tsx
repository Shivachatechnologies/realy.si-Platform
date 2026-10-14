import { ForgotPasswordForm } from "@/components/auth/recovery-forms";
import { getT } from "@/i18n/server";

export default async function Page() {
  const t = await getT();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("auth.forgotTitle")}</h1>
        <p className="text-muted-foreground">{t("auth.forgotSubtitle")}</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
