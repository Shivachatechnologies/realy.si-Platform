import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/shell/switchers";
import { getLocale, getT } from "@/i18n/server";
import { getSession, requireViewer } from "@/server/session";

/** Admin console shell: its own URL space (/admin), login (/admin/login) and chrome, separate from the company app. */
export default async function AdminConsoleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/admin/login`);
  if (session.mfaPending) redirect(`/${locale}/mfa?next=${encodeURIComponent(`/${locale}/admin`)}`);
  const viewer = await requireViewer(locale);
  // On the admin subdomain the company app is another deployment (USER_APP_URL); otherwise it is this one.
  const appHref = process.env.APP_SURFACE === "admin" ? process.env.USER_APP_URL : `/${locale}`;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Link href={`/${locale}/admin`} className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span>{t("common.appName")}</span>
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("admin.title")}
          </span>
        </Link>
        <div className="ms-auto flex items-center gap-2">
          {appHref ? (
            <a href={appHref} className="hidden text-xs text-muted-foreground hover:text-foreground hover:underline sm:inline">
              {t("admin.openApp")}
            </a>
          ) : null}
          <LanguageSwitcher signedIn className="hidden sm:inline-flex" />
          <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">{viewer.user.name}</span>
          <SignOutButton to="admin/login" />
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
