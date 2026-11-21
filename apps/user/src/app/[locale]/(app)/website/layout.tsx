import { World } from "@/components/ui/world";

/** website: themed as the "marketing" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="marketing">{children}</World>;
}
