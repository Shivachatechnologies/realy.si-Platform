import { World } from "@/components/ui/world";

/** livechat: themed as the "support" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="support">{children}</World>;
}
