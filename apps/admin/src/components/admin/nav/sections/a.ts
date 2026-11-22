import { LayoutDashboard } from "lucide-react";
import type { NavSection } from "../types";

/** Stream A — command center, action center, notifications, personal settings. */
export const sectionsA: NavSection[] = [{ id: "overview", href: "", label: "admin.nav.overview", icon: LayoutDashboard, order: 10, perms: [] }];
