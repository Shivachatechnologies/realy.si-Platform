import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /integrations page inherits the "integrations" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/integrations">) {
  return <World name="integrations">{children}</World>;
}
