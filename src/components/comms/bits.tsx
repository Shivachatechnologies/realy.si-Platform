import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import type { Translate } from "@/i18n/translate";
import { formatDateTime } from "@/i18n/format";
import { Markdownish } from "./markdownish";

/** Secondary navigation (tabs) shared by the Communication and Support areas. */
export function SectionTabs({ label, tabs, active }: { label: string; tabs: { key: string; href: string; label: string; badge?: number }[]; active: string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {tab.label}
          {tab.badge ? <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">{tab.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1">
        <h1 className="font-display text-display-lg">{title}</h1>
        {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", tone === "warning" && "text-warning", tone === "danger" && "text-danger")}>{value}</p>
    </Card>
  );
}

/** "Older / newer" or numbered paging with plain links (keeps filters in the query string). */
export function Pager({ prevHref, nextHref, labels, info }: { prevHref?: string | null; nextHref?: string | null; labels: { prev: string; next: string }; info?: ReactNode }) {
  if (!prevHref && !nextHref) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-sm">
      {prevHref ? (
        <Link className="hover:underline" href={prevHref}>
          ← {labels.prev}
        </Link>
      ) : (
        <span />
      )}
      {info ? <span className="text-xs text-muted-foreground">{info}</span> : null}
      {nextHref ? (
        <Link className="hover:underline" href={nextHref}>
          {labels.next} →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

/** Build a URL keeping current filters, with overrides (undefined / "" removes a key). */
type QueryParams = Record<string, string | string[] | undefined>;
type QueryChanges = Record<string, string | number | undefined | null>;

export function hrefWith(path: string, current: QueryParams, changes: QueryChanges) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one) p.set(k, one);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export const MEETING_TONE = { SCHEDULED: "accent", COMPLETED: "success", CANCELLED: "neutral" } as const;

export const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;

export interface SubjectTask {
  id: string;
  title: string;
  status: keyof typeof TASK_TONE;
  createdAt: Date;
  output: string | null;
}

/** AI work attached to a record: status, link to /tasks/<id> and the latest completed output. */
export function AiTasksCard({ t, locale, tz, title, description, tasks, actions, notConfigured, extra }: {
  t: Translate;
  locale: string;
  tz: string;
  title: string;
  description?: string;
  tasks: SubjectTask[];
  actions?: ReactNode;
  notConfigured: boolean;
  extra?: (task: SubjectTask) => ReactNode;
}) {
  const latest = tasks.find((x) => x.status === "COMPLETED" && x.output);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="grid gap-3">
        {notConfigured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : actions}
        {tasks.length ? (
          <ul className="grid gap-1 text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                <Link href={`/${locale}/tasks/${task.id}`} className="min-w-0 truncate hover:underline">
                  {task.title}
                </Link>
                <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {latest ? (
          <div className="grid gap-2 rounded-md border bg-surface-2 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t("communication.ai.latestOutput")}</p>
            <Markdownish text={latest.output!} />
            {extra ? extra(latest) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}
