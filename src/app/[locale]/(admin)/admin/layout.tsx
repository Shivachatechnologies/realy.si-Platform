import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertOctagon, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/shell/switchers";
import { Notice } from "@/components/ui/notice";
import { AdminSearchBox, AdminSidebar } from "@/components/admin/admin-sidebar";
import { getLocale, getT } from "@/i18n/server";
import { CONTROL_DEFS, CONTROL_KEYS, emergencyState } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
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
  // Switches are searchable (by key and translated label) for admins who may read them.
  const controls = grants.length && (await canPlatform(viewer.ctx, "platform.audit.read")) ? CONTROL_KEYS.map((key) => ({ key, group: CONTROL_DEFS[key].group })) : [];
  // On the admin subdomain the company app is another deployment (USER_APP_URL); otherwise it is this one.
  const appHref = process.env.APP_SURFACE === "admin" ? process.env.USER_APP_URL : `/${locale}`;
  return (
    <div data-surface="admin" className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/80 px-4 py-2.5 backdrop-blur-md sm:px-6">
        <Link href={`/${locale}/admin`} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span className="hidden md:inline">{t("common.appName")}</span>
          <span className="hidden items-center gap-1 rounded-full border border-primary/30 bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground min-[480px]:inline-flex">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("admin.title")}
          </span>
        </Link>
        {grants.length ? (
          <div className="ms-1 min-w-0 flex-1 sm:ms-2">
            <AdminSearchBox controls={controls} />
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
            <AdminSidebar />
          </aside>
          <main className="grid min-w-0 content-start gap-4">
            {emergency.active ? (
              <div role="alert" className="relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm shadow-elev-2">
                <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-danger" />
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-danger/15 text-danger">
                  <AlertOctagon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-danger">
                    <span className="live-dot size-2" data-pulse="true" aria-hidden />
                    {t("admin.emergency.title")}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {emergency.flags.map((f) => (
                      <span key={f} className="rounded-full border border-danger/40 bg-surface/60 px-2 py-0.5 text-[11px] font-medium text-danger">
                        {t(`admin.controls.keys.${f}.label`)}
                      </span>
                    ))}
                  </div>
                </div>
                <Link href={`/${locale}/admin/controls`} className="ms-auto inline-flex h-8 items-center rounded-md bg-danger px-3 text-xs font-semibold text-danger-foreground hover:opacity-90 focus-visible:outline-2">
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
