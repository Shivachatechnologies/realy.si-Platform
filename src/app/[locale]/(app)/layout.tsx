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

/** On the user surface the admin console lives on its own subdomain; link to it only when ADMIN_URL is configured. */
const adminReachable = () =>
  process.env.APP_SURFACE !== "user" || !!process.env.ADMIN_URL;

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
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {org ? (
        <ContextSwitcher
          orgs={orgs}
          orgId={org.id}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          companyId={company?.id ?? null}
        />
      ) : null}
      <div className="ms-auto flex min-w-0 items-center justify-end gap-2">
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

export default function AppLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <>
      <Suspense fallback={null}>
        <OrgBranding />
      </Suspense>
      <AppFrame
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
    </>
  );
}
