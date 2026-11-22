import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertOctagon, ShieldCheck } from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/shell/switchers";
import { Notice } from "@/components/ui/notice";
import { ToastProvider } from "@/components/ui/toast";
import { AdminNavDrawer, AdminSidebar } from "@/components/admin/admin-sidebar";
import { EnvBadge, environmentInfo } from "@/components/admin/env-badge";
import { ShellBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CommandPalette } from "@/components/admin/palette/command-palette";
import { CopilotPanel } from "@/components/admin/copilot/copilot-panel";
import { SideDrawer } from "@/components/admin/drawer";
import { CreateMenu } from "@/components/shell/create-menu";
import { HealthIndicator } from "@/components/shell/health-indicator";
import { LiveStatus } from "@/components/shell/live-status";
import { MobileNavButton } from "@/components/shell/mobile-nav-button";
import { NotificationBell } from "@/components/shell/notification-bell";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { ShellProvider } from "@/components/shell/shell-context";
import { getLocale, getT } from "@/i18n/server";
import { logger } from "@/server/core/logger";
import { CONTROL_DEFS, CONTROL_KEYS, emergencyState } from "@/server/core/platform-controls";
import { actionBadges } from "@/server/modules/admin/action-center";
import { MONITOR_PERMS } from "@/server/modules/admin/monitoring";
import { unreadNotificationCount } from "@/server/modules/admin/notifications";
import { shellHealth, shellIncidents } from "@/server/modules/admin/overview";
import { consolePermissions, preferencesFor } from "@/server/modules/admin/preferences";
import { getSession, requireViewer } from "@/server/session";
import { platformGrants } from "@/server/workspace";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Shell data must never take the console down: a failing part degrades to its empty state. */
async function soft<T>(p: Promise<T>, fallback: T, what: string): Promise<T> {
  try {
    return await p;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), what }, "console shell data unavailable");
    return fallback;
  }
}

/**
 * Super Admin Control Center shell (apps/admin, admin.realy.si): its own deployment, login (/[locale]/login) and chrome,
 * separate from the company app. Top bar (environment, ⌘K search, create menu, platform status, live clock, bell,
 * profile), a permission-filtered sidebar (collapsible; a drawer on small screens), breadcrumbs on every page and a
 * banner whenever an emergency switch is active. Density (compact mode) follows the admin's preference.
 */
export default async function AdminLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.mfaPending) redirect(`/${locale}/mfa?next=${encodeURIComponent(`/${locale}`)}`);
  const viewer = await requireViewer(locale);
  const grants = await platformGrants(viewer.user.id);
  const base = `/${locale}`;
  const env = environmentInfo();

  if (grants.length === 0) {
    return (
      <ClientMessages scope="[locale]/(console)">
        <ToastProvider>
          <div data-surface="admin" className="flex min-h-dvh flex-col">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/80 px-4 py-2.5 backdrop-blur-md sm:px-6">
              <BrandMark />
              <span className="ms-auto">
                <SignOutButton />
              </span>
            </header>
            <main className="flex-1 px-4 py-6 sm:px-6">
              <Notice tone="warning">{t("admin.noAccess")}</Notice>
            </main>
          </div>
        </ToastProvider>
      </ClientMessages>
    );
  }

  const perms = await consolePermissions(viewer.ctx);
  const permSet = new Set(perms);
  const monitor = MONITOR_PERMS.some((p) => permSet.has(p));
  // Stream C's read-only Admin Copilot as a shell side panel (the full page stays at /copilot).
  const copilot = permSet.has("platform.copilot.use");
  const incidentReader = permSet.has("platform.incidents.read") || permSet.has("platform.incidents.manage");
  const [prefs, emergency, badges, unread, health, incidents] = await Promise.all([
    preferencesFor(viewer.user.id),
    soft(emergencyState(), { active: false, flags: [] as string[] }, "emergency"),
    soft(actionBadges(viewer.ctx), {} as Record<string, number>, "badges"),
    soft(unreadNotificationCount(viewer.ctx), 0, "notifications"),
    monitor ? soft(shellHealth(), null, "health") : Promise.resolve(null),
    incidentReader ? soft<{ active: number; major: number } | null>(shellIncidents(), null, "incidents") : Promise.resolve(undefined),
  ]);
  // Switches are searchable (by key and translated label) for admins who may read them.
  const controls = permSet.has("platform.audit.read") ? CONTROL_KEYS.map((key) => ({ key, group: CONTROL_DEFS[key].group })) : [];
  // The company app is another deployment (apps/user at USER_APP_URL).
  const appHref = process.env.USER_APP_URL;
  const roles = [...new Set(grants.map((g) => g.roleKey))];

  return (
    <ClientMessages scope="[locale]/(console)">
      <ToastProvider>
        <ShellProvider
          perms={perms}
          badges={{ ...badges, "notifications.unread": unread }}
          prefs={{ favorites: prefs.favorites, recents: prefs.recents, recentSearches: prefs.recentSearches, collapsed: prefs.sidebar.collapsed, groups: prefs.sidebar.groups, density: prefs.density, timeRange: prefs.timeRange }}
        >
          <div data-surface="admin" data-density={prefs.density} data-env={env.env} className="flex min-h-dvh flex-col">
            {env.env !== "production" ? <div aria-hidden className={env.env === "preview" ? "h-1 bg-warning" : "h-1 bg-info"} /> : null}
            <a href="#console-main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-elev-3">
              {t("admin.shell.skipToContent")}
            </a>
            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
              <MobileNavButton />
              <Link href={base} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
                <BrandMark />
                <BrandName className="hidden md:inline" />
                <span className="hidden items-center gap-1 rounded-full border border-primary/30 bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground min-[480px]:inline-flex">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  {t("admin.title")}
                </span>
              </Link>
              <EnvBadge className="hidden sm:inline-flex" />
              <div className="ms-1 min-w-0 flex-1 sm:ms-2">
                <CommandPalette controls={controls} />
              </div>
              <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
                <HealthIndicator base={base} health={health} incidents={incidents} />
                <LiveStatus profileZone={viewer.user.timezone} />
                {copilot ? (
                  <SideDrawer label={t("admin.copilot.title")} title={t("admin.copilot.title")} description={t("admin.copilot.conversationHint")} triggerClassName="hidden md:inline-flex">
                    <CopilotPanel base={base} suggestions={["health", "failedJobs", "spenders", "pastDue"].map((k) => t(`admin.copilot.suggestions.${k}`))} />
                  </SideDrawer>
                ) : null}
                <CreateMenu />
                <NotificationBell initialCount={unread} />
                {appHref ? (
                  <a href={appHref} className="hidden text-xs text-muted-foreground hover:text-foreground hover:underline xl:inline">
                    {t("admin.openApp")}
                  </a>
                ) : null}
                <LanguageSwitcher signedIn className="hidden sm:inline-flex" />
                <ProfileMenu name={viewer.user.name} email={viewer.user.email} roles={roles} />
              </div>
            </header>
            <AdminNavDrawer />
            <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 py-4 sm:px-5 lg:gap-6">
              <AdminSidebar />
              <main id="console-main" tabIndex={-1} className="grid min-w-0 flex-1 content-start gap-4 outline-none">
                <ShellBreadcrumbs />
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
                    <Link href={`${base}/controls`} className="ms-auto inline-flex h-8 items-center rounded-md bg-danger px-3 text-xs font-semibold text-danger-foreground hover:opacity-90 focus-visible:outline-2">
                      {t("admin.emergency.manage")}
                    </Link>
                  </div>
                ) : null}
                {!viewer.user.mfaEnabled ? <Notice tone="warning">{t("admin.mfaNotice")}</Notice> : null}
                {children}
              </main>
            </div>
          </div>
        </ShellProvider>
      </ToastProvider>
    </ClientMessages>
  );
}
