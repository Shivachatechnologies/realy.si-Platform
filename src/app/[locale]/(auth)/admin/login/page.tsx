import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { SignInForm } from "@/components/auth/auth-forms";
import { getLocale, getT } from "@/i18n/server";
import { getSession } from "@/server/session";
import { platformGrants } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.signInTitle") };
}

/** Admin console login — separate from the user sign-in at /sign-in. Lands on /admin. */
export default async function AdminLoginPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const session = await getSession();
  if (session && !session.mfaPending && (await platformGrants(session.userId)).length > 0) redirect(`/${locale}/admin`);
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden />
          {t("admin.title")}
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{t("admin.signInTitle")}</h1>
        <p className="text-muted-foreground">{t("admin.signInSubtitle")}</p>
      </div>
      <SignInForm variant="admin" />
    </div>
  );
}
