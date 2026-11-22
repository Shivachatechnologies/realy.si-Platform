import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** livechat: themed as the "support" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/livechat">
      <World name="support">{children}</World>
    </ClientMessages>
  );
}
