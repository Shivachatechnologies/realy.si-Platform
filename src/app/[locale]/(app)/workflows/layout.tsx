import { World } from "@/components/ui/world";

/** workflows: themed as the "automation" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="automation">{children}</World>;
}
