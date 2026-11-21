import Link from "next/link";
import { Suspense } from "react";
import { BrandMark, BrandName } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { UserMenu } from "@/components/shell/switchers";
import { BrandingStyle } from "@/components/enterprise/branding-style";
import { Aurora } from "@/components/motion/aurora";
import { getLocale } from "@/i18n/server";
import { getWorkspaceContext, requireViewer } from "@/server/session";

/**
 * Full-screen immersive shell of the onboarding journey: no app sidebar or top bar, only the brand, the language and
 * the account menu over an ambient scene. Same guards as the (app) layout: a signed-in viewer is required
 * (requireViewer redirects to sign-in) and the active organization's white-label theme applies.
 */
export default async function JourneyLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const { org } = await getWorkspaceContext(viewer.user.id);
  return (
    <div data-world="command" className="relative isolate flex min-h-dvh flex-col bg-background text-foreground">
      <Suspense fallback={null}>
        <BrandingStyle organizationId={org?.id} />
      </Suspense>
      <Aurora />
      <header className="sticky top-0 z-30 flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-6">
        <Link href={`/${locale}`} className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
          <BrandMark className="size-6" />
          <BrandName className="hidden text-[17px] sm:inline" />
        </Link>
        <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher signedIn />
          <UserMenu name={viewer.user.name} email={viewer.user.email} />
        </div>
      </header>
      <main id="main" className="relative z-10 flex-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
        {children}
      </main>
    </div>
  );
}
