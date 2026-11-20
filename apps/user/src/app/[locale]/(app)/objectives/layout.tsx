import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /objectives page inherits the "projects" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/objectives">) {
  return <World name="projects">{children}</World>;
}
