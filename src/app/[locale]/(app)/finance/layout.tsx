import { World } from "@/components/ui/world";

/** finance: themed as the "finance" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="finance">{children}</World>;
}
