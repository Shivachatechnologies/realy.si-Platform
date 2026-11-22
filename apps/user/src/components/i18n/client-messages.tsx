import { I18nProvider } from "@/i18n/client";
import { getClientMessages } from "@/i18n/server";

/**
 * A client-message boundary: provides the namespaces the client components of this layout's subtree use (merged
 * over the enclosing boundaries'). `scope` is the layout's directory relative to src/app, e.g. "[locale]/(app)/crm";
 * scripts/i18n-namespaces.mjs computes its namespaces and checks the scope matches the file it is used in.
 */
export async function ClientMessages({ scope, children }: { scope: string; children: React.ReactNode }) {
  return <I18nProvider messages={await getClientMessages(scope)}>{children}</I18nProvider>;
}
