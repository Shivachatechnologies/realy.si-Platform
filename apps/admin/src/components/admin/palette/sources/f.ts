import { Activity, FileText, Flag, HardDrive, KeyRound, LifeBuoy, Mail, Phone, Plug, ScrollText, ShieldCheck, ToggleRight, Webhook } from "lucide-react";
import { commandSource, type PaletteSource } from "../types";

const CONTROL_PAGE: Record<string, string> = { ai: "/ai", kill: "/controls", settings: "/settings" };

/**
 * Stream F — platform switches (matched on key and translated label), integration providers, API keys, webhook
 * endpoints, feature flags, CMS entries, platform support tickets, audit records by request id, and quick commands.
 */
export const paletteF: PaletteSource[] = [
  {
    group: "controls",
    label: "admin.search.controls",
    order: 10,
    hits: ({ low, data, controls, base, t }) =>
      low.length < 2
        ? []
        : controls
            .filter((c) => data?.controls.includes(c.key) || t(`admin.controls.keys.${c.key}.label`).toLowerCase().includes(low))
            .slice(0, 6)
            .map((c) => ({ id: `ctl:${c.key}`, label: t(`admin.controls.keys.${c.key}.label`), sub: c.key, href: `${base}${CONTROL_PAGE[c.group] ?? "/controls"}`, icon: ToggleRight })),
  },
  {
    group: "integrations",
    label: "admin.nav.integrations",
    order: 60,
    hits: ({ data, base, t }) =>
      (data?.integrations ?? []).map((i) => ({ id: `i:${i.provider}`, label: i.provider, sub: t("admin.search.connections", { count: i.connections }), href: `${base}/integrations/providers/${i.provider}`, icon: Plug })),
  },
  {
    group: "tickets",
    label: "admin.support.nav",
    order: 62,
    hits: ({ data, base }) => (data?.tickets ?? []).map((x) => ({ id: `tk:${x.id}`, label: `#${x.number} ${x.subject}`, sub: x.status, href: `${base}/support/${x.id}`, icon: LifeBuoy })),
  },
  {
    group: "apiKeys",
    label: "admin.developers.apiKeys",
    order: 64,
    hits: ({ data, base }) => (data?.apiKeys ?? []).map((k) => ({ id: `ak:${k.id}`, label: k.name, sub: `${k.prefix}…`, href: `${base}/developers/keys/${k.id}`, icon: KeyRound })),
  },
  {
    group: "webhooks",
    label: "admin.webhooks.nav",
    order: 66,
    hits: ({ data, base }) => (data?.webhooks ?? []).map((w) => ({ id: `wh:${w.id}`, label: w.name, sub: w.url, href: `${base}/webhooks/${w.id}`, icon: Webhook })),
  },
  {
    group: "flags",
    label: "admin.nav.flags",
    order: 68,
    hits: ({ data, base }) => (data?.flags ?? []).map((f) => ({ id: `ff:${f.id}`, label: f.key, href: `${base}/flags/${f.id}`, icon: Flag })),
  },
  {
    group: "cmsEntries",
    label: "admin.nav.cms",
    order: 69,
    hits: ({ data, base }) => (data?.cmsEntries ?? []).map((e) => ({ id: `cms:${e.id}`, label: e.slug, sub: e.kind, href: `${base}/cms/${e.id}`, icon: FileText })),
  },
  {
    group: "auditRequests",
    label: "admin.nav.audit",
    order: 71,
    hits: ({ data, base }) => (data?.auditRequests ?? []).map((a) => ({ id: `au:${a.id}`, label: a.action, sub: a.requestId, href: `${base}/audit/${a.id}`, icon: ScrollText })),
  },
  commandSource({
    group: "platformCommands",
    label: "admin.settings.kit.commands",
    order: 72,
    commands: [
      { id: "support-breached", label: "admin.support.cmdBreached", href: "/support?sla=breached", icon: LifeBuoy, perms: ["platform.support.read"], keywords: ["sla", "support", "ticket"] },
      { id: "support-mine", label: "admin.support.cmdMine", href: "/support?assignee=me", icon: LifeBuoy, perms: ["platform.support.read"], keywords: ["support", "ticket"] },
      { id: "webhooks-failing", label: "admin.webhooks.cmdFailing", href: "/webhooks?state=failing", icon: Webhook, perms: ["platform.security.read"], keywords: ["webhook", "delivery"] },
      { id: "api-5xx", label: "admin.apiLogs.cmd5xx", href: "/api-logs?status=5xx", icon: Activity, perms: ["platform.logs.read", "platform.security.read"], keywords: ["api", "error", "500"] },
      { id: "email-bounces", label: "admin.email.cmdBounces", href: "/email?outcome=bounced", icon: Mail, perms: ["platform.controls.manage", "platform.security.read"], keywords: ["email", "bounce"] },
      { id: "security-posture", label: "admin.security.posture.title", href: "/security/posture", icon: ShieldCheck, perms: ["platform.security.read", "platform.audit.read"], keywords: ["mfa", "security", "posture"] },
      { id: "telephony", label: "admin.telephony.nav", href: "/telephony", icon: Phone, perms: ["platform.organizations.read"], keywords: ["voice", "calls"] },
      { id: "files", label: "admin.files.nav", href: "/files", icon: HardDrive, perms: ["platform.organizations.read"], keywords: ["storage", "files"] },
    ],
  }),
];
