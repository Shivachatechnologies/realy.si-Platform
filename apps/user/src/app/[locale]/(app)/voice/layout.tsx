import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** AI phone team: themed as the "sales" world (Design DNA v2). */
export default function VoiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/voice">
      <World name="sales">{children}</World>
    </ClientMessages>
  );
}
