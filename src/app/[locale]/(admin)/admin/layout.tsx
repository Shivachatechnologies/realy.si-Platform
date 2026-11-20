import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertOctagon, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/shell/switchers";
import { Notice } from "@/components/ui/notice";
import { AdminSearchBox, AdminSidebar } from "@/components/admin/admin-sidebar";
import { getLocale, getT } from "@/i18n/server";
import { emergencyState } from "@/server/core/platform-controls";
import { getSession, requireViewer } from "@/server/session";
import { platformGrants } from "@/server/workspace";

/**
 * Super Admin Control Center shell: its own URL space (/admin), login (/admin/login) and chrome, separate from the
 * company app. Left sidebar, global search (⌘K) and a banner whenever an emergency switch is active.
 */
export default async function AdminLayout({ children }: LayoutProps<"/[locale]/admin">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/admin/login`);
  if (session.mfaPending) redirect(`/${locale}/mfa?next=${encodeURIComponent(`/${locale}/admin`)}`);
  const viewer = await requireViewer(locale);
  const grants = await platformGrants(viewer.user.id);
  const emergency = grants.length ? await emergencyState() : { active: false, flags: [] as string[] };
  // On the admin subdomain the company app is another deployment (USER_APP_URL); otherwise it is this one.
  const appHref = process.env.APP_SURFACE === "admin" ? process.env.USER_APP_URL : `/${locale}`;
  return (
    <div data-surface="admin" className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2.5 sm:px-6">
        <Link href={`/${locale}/admin`} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span className="hidden sm:inline">{t("common.appName")}</span>
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("admin.title")}
          </span>
        </Link>
        {grants.length ? (
          <div className="ms-2 hidden min-w-0 flex-1 md:block">
            <AdminSearchBox />
          </div>
        ) : null}
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
      {grants.length === 0 ? (
        <main className="flex-1 px-4 py-6 sm:px-6">
          <Notice tone="warning">{t("admin.noAccess")}</Notice>
        </main>
      ) : (
        <div className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6">
          <aside className="min-w-0">
            <div className="mb-3 md:hidden">
              <AdminSearchBox />
            </div>
            <AdminSidebar />
          </aside>
          <main className="grid min-w-0 content-start gap-4">
            {emergency.active ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
                <AlertOctagon className="size-4 shrink-0" aria-hidden />
                <span className="font-medium">{t("admin.emergency.title")}</span>
                <span className="text-xs">{emergency.flags.map((f) => t(`admin.controls.keys.${f}.label`)).join(" · ")}</span>
                <Link href={`/${locale}/admin/controls`} className="ms-auto text-xs font-medium underline">
                  {t("admin.emergency.manage")}
                </Link>
              </div>
            ) : null}
            {!viewer.user.mfaEnabled ? <Notice tone="warning">{t("admin.mfaNotice")}</Notice> : null}
            {children}
          </main>
        </div>
      )}
    </div>
  );
}
