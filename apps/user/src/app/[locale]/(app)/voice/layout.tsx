import { World } from "@/components/ui/world";

/** AI phone team: themed as the "sales" world (Design DNA v2). */
export default function VoiceLayout({ children }: { children: React.ReactNode }) {
  return <World name="sales">{children}</World>;
}
