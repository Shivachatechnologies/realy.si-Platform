import { World } from "@/components/ui/world";

/** Creative studio: themed as the "marketing" world (Design DNA v2). */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <World name="marketing">{children}</World>;
}
