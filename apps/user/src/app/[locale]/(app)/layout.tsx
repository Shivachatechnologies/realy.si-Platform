import { Suspense } from "react";
import { AppFrame } from "@/components/shell/app-frame";
import { CommandPalette } from "@/components/shell/command-palette";
import { ContextSwitcher, UserMenu } from "@/components/shell/switchers";
import { AiActivityIndicator } from "@/components/shell/ai-activity";
import { AdminNavLink } from "@/components/shell/sidebar";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocale } from "@/i18n/server";
import { getWorkspaceContext, requireViewer } from "@/server/session";
import { listCompanies } from "@/server/modules/companies/service";
import { platformGrants } from "@/server/workspace";
import { BrandingStyle } from "@/components/enterprise/branding-style";
import { GuideMount } from "@/components/guide/guide-mount";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { lockedNavHrefs } from "@/server/modules/entitlements/service";
import { NAV } from "@/components/shell/nav";
import { PlatformBanner } from "@/components/cms/platform-banner";
import { ClientMessages } from "@/components/i18n/client-messages";
import { ImpersonationBanner } from "../impersonate/[token]/banner";

/** The admin console is a separate app (apps/admin); link to it only when ADMIN_URL is configured. */
const adminReachable = () => !!process.env.ADMIN_URL;

/** Real AI workload of the active company (running / queued agent tasks); null when the viewer may not see tasks. */
async function aiActivity(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  if (!(await can(ctx, "agents.read", chain))) return null;
  const rows = await db().agentTask.groupBy({
    by: ["status"],
    where: { organizationId, companyId, status: { in: ["RUNNING", "QUEUED"] } },
    _count: { _all: true },
  });
  const count = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { running: count("RUNNING"), queued: count("QUEUED") };
}

async function Topbar() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const { orgs, org, preferredCompanyId } = await getWorkspaceContext(
    viewer.user.id,
  );
  const companies = org
    ? (await listCompanies(viewer.ctx, org.id, { limit: 200 })).data
    : [];
  const company =
    companies.find((c) => c.id === preferredCompanyId) ?? companies[0] ?? null;
  const isAdmin =
    (await platformGrants(viewer.user.id)).length > 0 && adminReachable();
  const activity =
    org && company
      ? await aiActivity(viewer.ctx, org.id, company.id).catch(() => null)
      : null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      {org ? (
        <ContextSwitcher
          orgs={orgs}
          orgId={org.id}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          companyId={company?.id ?? null}
        />
      ) : null}
      <div className="ms-auto flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
        {activity ? (
          <div className="hidden xl:block">
            <AiActivityIndicator
              running={activity.running}
              queued={activity.queued}
            />
          </div>
        ) : null}
        <CommandPalette showAdmin={isAdmin} />
        <LanguageSwitcher signedIn className="hidden sm:inline-flex" />
        <UserMenu name={viewer.user.name} email={viewer.user.email} />
      </div>
    </div>
  );
}

async function AdminLink() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const grants = await platformGrants(viewer.user.id);
  return grants.length > 0 && adminReachable() ? <AdminNavLink /> : null;
}

/** White-label theme of the active organization (Settings → Branding). */
async function OrgBranding() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const { org } = await getWorkspaceContext(viewer.user.id);
  return <BrandingStyle organizationId={org?.id} />;
}

/** Nav entries the active organization's plan does not include (lock badge in the sidebar / tab bar). */
async function lockedHrefsForViewer(): Promise<string[]> {
  try {
    const viewer = await requireViewer(await getLocale());
    const { org } = await getWorkspaceContext(viewer.user.id);
    if (!org) return [];
    return await lockedNavHrefs(org.id, NAV.flatMap((s) => s.items.map((i) => i.href)));
  } catch {
    // Never fail the shell over a badge (the viewer is already authenticated by the layout).
    return [];
  }
}

function PageFallback() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-32" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: LayoutProps<"/[locale]">) {
  // Authenticate before anything streams: a signed-out visitor (or an expired session cookie) is redirected to
  // sign-in by the server, instead of briefly seeing the app shell before a page-level redirect.
  const locale = await getLocale();
  await requireViewer(locale);
  const lockedHrefs = await lockedHrefsForViewer();
  return (
    <ClientMessages scope="[locale]/(app)">
      <Suspense fallback={null}>
        <ImpersonationBanner locale={locale} />
      </Suspense>
      <Suspense fallback={null}>
        <OrgBranding />
      </Suspense>
      <Suspense fallback={null}>
        <PlatformBanner />
      </Suspense>
      <AppFrame
        lockedHrefs={lockedHrefs}
        topbar={
          <Suspense fallback={<Skeleton className="h-8 w-64" />}>
            <Topbar />
          </Suspense>
        }
        adminSlot={
          <Suspense fallback={null}>
            <AdminLink />
          </Suspense>
        }
      >
        <Suspense fallback={<PageFallback />}>
          <GuideMount>{children}</GuideMount>
        </Suspense>
      </AppFrame>
    </ClientMessages>
  );
}
