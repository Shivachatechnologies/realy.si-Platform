import { World } from "@/components/ui/world";

/** crm: themed as the "sales" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="sales">{children}</World>;
}
