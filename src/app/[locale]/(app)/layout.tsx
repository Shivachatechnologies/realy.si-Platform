import { Suspense } from "react";
import { AppFrame } from "@/components/shell/app-frame";
import { CommandPalette } from "@/components/shell/command-palette";
import { ContextSwitcher, SignOutButton } from "@/components/shell/switchers";
import { AdminNavLink } from "@/components/shell/sidebar";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocale } from "@/i18n/server";
import { getWorkspaceContext, requireViewer } from "@/server/session";
import { listCompanies } from "@/server/modules/companies/service";
import { platformGrants } from "@/server/workspace";

async function Topbar() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const { orgs, org, preferredCompanyId } = await getWorkspaceContext(viewer.user.id);
  const companies = org ? (await listCompanies(viewer.ctx, org.id, { limit: 200 })).data : [];
  const company = companies.find((c) => c.id === preferredCompanyId) ?? companies[0] ?? null;
  const isAdmin = (await platformGrants(viewer.user.id)).length > 0;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {org ? (
        <ContextSwitcher orgs={orgs} orgId={org.id} companies={companies.map((c) => ({ id: c.id, name: c.name }))} companyId={company?.id ?? null} />
      ) : null}
      <div className="ms-auto flex shrink-0 items-center justify-end gap-2">
        <CommandPalette showAdmin={isAdmin} />
        <LanguageSwitcher signedIn className="hidden sm:inline-flex" />
        <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">{viewer.user.name}</span>
        <SignOutButton />
      </div>
    </div>
  );
}

async function AdminLink() {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const grants = await platformGrants(viewer.user.id);
  return grants.length > 0 ? <AdminNavLink /> : null;
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
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </AppFrame>
  );
}
