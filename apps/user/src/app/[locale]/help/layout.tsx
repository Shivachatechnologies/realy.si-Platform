import { ClientMessages } from "@/components/i18n/client-messages";

/** Sends the browser only the message namespaces these pages' client components use (scripts/i18n-namespaces.mjs). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages scope="[locale]/help">{children}</ClientMessages>;
}
