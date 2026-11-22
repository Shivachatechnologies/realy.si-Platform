import { Globe2, Plug, Settings, ShieldCheck, SlidersHorizontal, Store } from "lucide-react";
import type { NavSection } from "../types";

const CONTENT = ["platform.content.manage"];
const AUDIT = ["platform.audit.read", "platform.security.read"];
const INTEGRATIONS = ["platform.security.read", "platform.organizations.read", "platform.controls.manage"];
const KEYS = ["platform.controls.manage", "platform.security.manage", "platform.security.read"];
const SETTINGS = ["platform.controls.manage", "platform.audit.read"];

/** Stream F — content, marketplace, controls and flags, integrations, security and audit, settings and keys. */
export const sectionsF: NavSection[] = [
  {
    id: "content",
    href: "/cms",
    label: "admin.nav.content",
    icon: Globe2,
    order: 60,
    perms: [...CONTENT, "platform.audit.read"],
    children: [
      { id: "cms", href: "/cms", label: "admin.nav.cms", perms: CONTENT },
      { id: "media", href: "/cms/media", label: "admin.nav.media", perms: CONTENT },
      { id: "emailTemplates", href: "/email-templates", label: "admin.nav.emailTemplates", perms: CONTENT },
      { id: "announcements", href: "/announcements", label: "admin.nav.announcements", perms: ["platform.controls.manage", "platform.content.manage", "platform.audit.read"] },
    ],
  },
  { id: "marketplace", href: "/marketplace", label: "admin.nav.marketplace", icon: Store, order: 70, perms: CONTENT },
  {
    id: "features",
    href: "/controls",
    label: "admin.nav.features",
    icon: SlidersHorizontal,
    order: 80,
    perms: ["platform.controls.manage", "platform.audit.read", "platform.ai.read", "flags.read", "flags.manage"],
    children: [
      { id: "controls", href: "/controls", label: "admin.nav.controls", perms: ["platform.controls.manage", "platform.audit.read", "platform.ai.read"] },
      { id: "flags", href: "/flags", label: "admin.nav.flags", perms: ["flags.read", "flags.manage"] },
    ],
  },
  {
    id: "integrations",
    href: "/integrations",
    label: "admin.nav.integrations",
    icon: Plug,
    order: 90,
    perms: INTEGRATIONS,
    children: [
      { id: "integrations", href: "/integrations", label: "admin.nav.integrations", perms: INTEGRATIONS },
      { id: "developers", href: "/developers", label: "admin.nav.developers", perms: INTEGRATIONS },
    ],
  },
  {
    id: "securityAudit",
    href: "/audit",
    label: "admin.nav.securityAudit",
    icon: ShieldCheck,
    order: 110,
    perms: AUDIT,
    children: [
      { id: "audit", href: "/audit", label: "admin.nav.audit", perms: AUDIT },
      { id: "security", href: "/security", label: "admin.nav.security", perms: AUDIT },
      { id: "securityAccess", href: "/security/access", label: "admin.nav.securityAccess", perms: AUDIT },
    ],
  },
  {
    id: "settings",
    href: "/settings",
    label: "admin.nav.settings",
    icon: Settings,
    order: 120,
    perms: [...SETTINGS, ...KEYS],
    children: [
      { id: "settings", href: "/settings", label: "admin.nav.settings", perms: SETTINGS },
      { id: "keys", href: "/keys", label: "admin.nav.keys", perms: KEYS },
    ],
  },
];
