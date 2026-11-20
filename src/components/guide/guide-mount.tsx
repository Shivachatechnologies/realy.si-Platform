import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { activeScope } from "./scope-server";
import { GuideLauncher } from "./guide-launcher";
import { GuideScopeProvider } from "./guide-scope";

/** Wraps the app pages: provides the guide scope (SmartEmptyState, WhatsNext actions) and renders the AI Guide. */
export async function GuideMount({ children }: { children: ReactNode }) {
  const scope = await activeScope().then(({ orgId, companyId }) => ({ orgId, companyId })).catch((err: unknown) => {
    unstable_rethrow(err); // redirects / not-found keep working; anything else just hides the guide's scope
    return { orgId: null, companyId: null };
  });
  return (
    <GuideScopeProvider value={scope}>
      {children}
      <GuideLauncher />
    </GuideScopeProvider>
  );
}
