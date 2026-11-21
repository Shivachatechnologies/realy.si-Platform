import { MfaForm } from "@/components/auth/auth-forms";
import { getT } from "@/i18n/server";

export default async function MfaPage() {
  const t = await getT();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("auth.mfaTitle")}</h1>
        <p className="text-muted-foreground">{t("auth.mfaSubtitle")}</p>
      </div>
      <MfaForm />
    </div>
  );
}
