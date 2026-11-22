import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { SignInForm } from "@/components/auth/auth-forms";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { getSession } from "@/server/session";
import { platformGrants } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.signInTitle") };
}

/** Control Center login (admin.realy.si/[locale]/login): platform administrators only, its own session cookie. */
export default async function AdminLoginPage({ searchParams }: PageProps<"/[locale]/login">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { error } = await searchParams;
  const session = await getSession();
  if (session && !session.mfaPending && (await platformGrants(session.userId)).length > 0) redirect(`/${locale}`);
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] text-accent-foreground uppercase">
          <ShieldCheck className="size-3.5" aria-hidden />
          {t("admin.title")}
        </span>
        <h1 className="text-lg font-semibold tracking-tight">{t("admin.signInTitle")}</h1>
        <p className="text-muted-foreground">{t("admin.signInSubtitle")}</p>
      </div>
      {error === "forbidden" ? <Notice tone="warning">{t("admin.noAccess")}</Notice> : null}
      <SignInForm resetUrl={process.env.USER_APP_URL ? `${process.env.USER_APP_URL}/${locale}/forgot-password` : null} />
    </div>
  );
}
