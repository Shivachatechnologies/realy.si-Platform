import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  Brain,
  Building2,
  CircleDollarSign,
  FolderKanban,
  Gauge,
  Handshake,
  Headphones,
  KeyRound,
  Megaphone,
  MessagesSquare,
  Network,
  Plug,
  Rocket,
  ShieldCheck,
  Store,
  Target,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import { formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** Icon + accent per module (first segment of an audit action or event type). */
const MODULES: [RegExp, ReactNode, string][] = [
  [/^(crm|lead|deal|sales|contact|account)/, <Handshake key="i" />, "text-success bg-success/10"],
  [/^(finance|invoice|expense|payment|bill|journal|ledger|payroll)/, <CircleDollarSign key="i" />, "text-success bg-success/10"],
  [/^(hr|employee|candidate|leave)/, <UserRound key="i" />, "text-danger bg-danger/10"],
  [/^(marketing|campaign|content|seo|social)/, <Megaphone key="i" />, "text-warning bg-warning/10"],
  [/^(support|ticket|kb)/, <Headphones key="i" />, "text-info bg-info/10"],
  [/^(work|project|task|sprint|milestone)/, <FolderKanban key="i" />, "text-primary bg-primary/10"],
  [/^(ops|operations|incident)/, <Gauge key="i" />, "text-muted-foreground bg-muted"],
  [/^(product)/, <Rocket key="i" />, "text-primary-2 bg-primary-2/10"],
  [/^(agent|ai|workforce|guide|command|ceo)/, <Bot key="i" />, "text-primary bg-primary/10"],
  [/^(approval)/, <ShieldCheck key="i" />, "text-warning bg-warning/10"],
  [/^(workflow|automation|schedule)/, <Workflow key="i" />, "text-warning bg-warning/10"],
  [/^(brain|document)/, <Brain key="i" />, "text-primary-2 bg-primary-2/10"],
  [/^(graph)/, <Network key="i" />, "text-info bg-info/10"],
  [/^(objective|goal|strategy|key_result)/, <Target key="i" />, "text-primary bg-primary/10"],
  [/^(comms|communication|announcement|meeting|notification)/, <MessagesSquare key="i" />, "text-info bg-info/10"],
  [/^(integration|webhook)/, <Plug key="i" />, "text-muted-foreground bg-muted"],
  [/^(marketplace)/, <Store key="i" />, "text-primary bg-primary/10"],
  [/^(auth|session|mfa|api_key|sso|security)/, <KeyRound key="i" />, "text-warning bg-warning/10"],
  [/^(membership|invitation|role|user|team|department)/, <Users key="i" />, "text-primary bg-primary/10"],
  [/^(company|organization|workspace)/, <Building2 key="i" />, "text-primary bg-primary/10"],
];

export function moduleVisual(key: string): { icon: ReactNode; tone: string } {
  const hit = MODULES.find(([re]) => re.test(key));
  return hit ? { icon: hit[1], tone: hit[2] } : { icon: <Activity />, tone: "text-muted-foreground bg-muted" };
}

export interface TimelineEntry {
  id: string;
  at: Date;
  /** Module / type key for the icon. */
  module: string;
  actor: string;
  text: string;
  record?: { label: string; href: string | null } | null;
  tags?: { label: string; tone?: "warning" | "danger" }[];
  danger?: boolean;
}

/** YYYY-MM-DD of a moment in a time zone. */
export const dayKey = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Day-grouped company timeline ("Today", "Yesterday", dates) with an icon per module and links to the records. */
export function DayTimeline({ entries, locale, timeZone, labels }: { entries: TimelineEntry[]; locale: string; timeZone: string; labels: { today: string; yesterday: string } }) {
  const now = new Date();
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const k = dayKey(e.at, timeZone);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone });
  return (
    <div className="grid gap-6">
      {[...groups.entries()].map(([k, items]) => (
        <section key={k} aria-labelledby={`day-${k}`} className="grid gap-2">
          <h3 id={`day-${k}`} className="sticky top-0 z-[2] flex items-center gap-2 bg-background/80 py-1 text-sm font-semibold backdrop-blur">
            {k === today ? labels.today : k === yesterday ? labels.yesterday : new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`))}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">{items.length}</span>
          </h3>
          <ol className="relative grid gap-0 ps-1">
            {items.map((e, i) => {
              const v = moduleVisual(e.module);
              return (
                <li key={e.id} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-3 pb-3 last:pb-0">
                  {i < items.length - 1 ? <span aria-hidden className="absolute start-[1.125rem] top-9 bottom-0 w-px bg-border" /> : null}
                  <span aria-hidden className={cn("relative z-[1] grid size-9 place-items-center rounded-full [&_svg]:size-4", e.danger ? "bg-danger/10 text-danger" : v.tone)}>
                    {v.icon}
                  </span>
                  <div className="grid min-w-0 gap-0.5 pt-1.5 text-sm">
                    <p className="break-words">
                      <span className="font-medium">{e.actor}</span> {e.text}
                      {e.record ? (
                        e.record.href ? (
                          <>
                            {" · "}
                            <Link className="text-primary hover:underline" href={e.record.href}>
                              {e.record.label}
                            </Link>
                          </>
                        ) : (
                          <span className="text-muted-foreground"> · {e.record.label}</span>
                        )
                      ) : null}
                    </p>
                    {e.tags?.length ? (
                      <span className="flex flex-wrap gap-1.5 text-[11px]">
                        {e.tags.map((tag) => (
                          <span key={tag.label} className={cn("rounded px-1.5 py-0.5", tag.tone === "warning" ? "bg-warning/10 text-warning" : tag.tone === "danger" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground")}>
                            {tag.label}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <time className="pt-2 text-xs tabular-nums text-muted-foreground" dateTime={e.at.toISOString()} title={formatDateTime(e.at, locale, timeZone)}>
                    {time.format(e.at)}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
