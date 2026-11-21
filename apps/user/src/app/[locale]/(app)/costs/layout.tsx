import { World } from "@/components/ui/world";

/** costs: spend control, themed as the "finance" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="finance">{children}</World>;
}
