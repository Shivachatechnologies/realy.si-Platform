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
  // data-surface="admin" switches the (auth) shell to the dark "Realy Control" look (see globals.css).
  return (
    <div data-surface="admin" className="control-room contents">
      <div className="grid gap-6">
        <div className="grid gap-2">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-medium tracking-[0.08em] text-primary uppercase">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("admin.title")}
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">{t("admin.signInTitle")}</h1>
          <p className="text-muted-foreground">{t("admin.signInSubtitle")}</p>
        </div>
        <SignInForm variant="admin" />
      </div>
    </div>
  );
}
