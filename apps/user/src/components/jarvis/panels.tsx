"use client";

import Link from "next/link";
import { Activity, Bot, CircleAlert, CircleCheck, PhoneCall, Radio, ShieldCheck } from "lucide-react";
import { StageRail } from "@/components/command/stage-rail";
import { useI18n } from "@/i18n/client";
import { formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { ALERT_EVENTS, SUCCESS_EVENTS } from "@/server/modules/voiceos/catalog";
import type { VoiceBootstrap } from "@/server/modules/voiceos/service";
import type { StreamItem, StreamStatus } from "./use-company-events";
import type { FollowedRun } from "./use-voice-os";

type T = (k: string, p?: Record<string, string | number>) => string;

const lookup = (t: T, key: string, fallback: string) => {
  const v = t(key);
  return v === key ? fallback : v;
};
const humanize = (s: string) => s.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** One stream item in plain language. */
export function describeItem(t: T, item: StreamItem): { text: string; tone: "info" | "success" | "warning" | "danger"; icon: typeof Activity } {
  switch (item.kind) {
    case "domain": {
      const type = lookup(t, `jarvis.events.types.${item.type.replace(/\./g, "_")}`, humanize(item.type));
      return {
        text: item.label ? `${type} · ${item.label}` : type,
        tone: ALERT_EVENTS.includes(item.type) ? "warning" : SUCCESS_EVENTS.includes(item.type) ? "success" : "info",
        icon: Activity,
      };
    }
    case "task":
      return {
        text: t("jarvis.events.task", { title: item.title, status: lookup(t, `agentTasks.status.${item.status}`, item.status) }),
        tone: item.status === "FAILED" ? "danger" : item.status === "COMPLETED" ? "success" : "info",
        icon: Bot,
      };
    case "run":
      return {
        text: item.mine && item.text ? t("jarvis.events.runMine", { text: item.text, status: lookup(t, `command.ai.runStatus.${item.status}`, item.status) }) : t("jarvis.events.run", { status: lookup(t, `command.ai.runStatus.${item.status}`, item.status) }),
        tone: item.status === "FAILED" ? "danger" : item.status === "COMPLETED" ? "success" : "info",
        icon: Radio,
      };
    case "approval":
      return {
        text: t("jarvis.events.approval", { summary: item.summary, status: lookup(t, `approvals.status.${item.status}`, item.status) }),
        tone: item.status === "PENDING" ? "warning" : item.status === "FAILED" || item.status === "REJECTED" ? "danger" : "success",
        icon: ShieldCheck,
      };
    case "call":
      return {
        text: t(item.direction === "INBOUND" ? "jarvis.events.callIn" : "jarvis.events.callOut", { status: lookup(t, `voice.status.${item.status}`, item.status) }),
        tone: item.status === "FAILED" ? "danger" : item.status === "ENDED" ? "success" : "info",
        icon: PhoneCall,
      };
  }
}

/** Live company events (real outbox rows and state changes), newest first. */
export function EventFeed({ items, status, className, max = 40 }: { items: StreamItem[]; status: StreamStatus; className?: string; max?: number }) {
  const { t, locale } = useI18n();
  return (
    <section className={cn("grid min-h-0 content-start gap-3", className)} aria-labelledby="jv-feed">
      <header className="flex items-center justify-between gap-2">
        <h2 id="jv-feed" className="text-sm font-semibold">{t("jarvis.feed.title")}</h2>
        <span className={cn("inline-flex items-center gap-1.5 text-xs", status === "live" ? "text-success" : "text-muted-foreground")}>
          <span aria-hidden className={cn("size-1.5 rounded-full", status === "live" ? "bg-success motion-safe:animate-pulse" : "bg-muted-foreground")} />
          {t(`jarvis.feed.status.${status}`)}
        </span>
      </header>
      {items.length ? (
        <ol className="grid gap-1.5" aria-live="polite" aria-relevant="additions">
          {items.slice(0, max).map((item) => {
            const d = describeItem(t, item);
            const Icon = d.tone === "success" ? CircleCheck : d.tone === "warning" || d.tone === "danger" ? CircleAlert : d.icon;
            return (
              <li key={item.key} className="flex items-start gap-2 rounded-md border bg-surface/70 px-2.5 py-2 text-xs animate-fade-in">
                <Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", d.tone === "success" ? "text-success" : d.tone === "warning" ? "text-warning" : d.tone === "danger" ? "text-danger" : "text-world")} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{d.text}</span>
                  <time dateTime={item.at} className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(item.at, locale)}
                  </time>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("jarvis.feed.empty")}</p>
      )}
    </section>
  );
}

type LiveRun = NonNullable<VoiceBootstrap["runs"]>[number];

/** The conversation's current command run (steps, real states) and the company's other live runs. */
export function RunsPanel({ run, runs, className }: { run: FollowedRun | null; runs: LiveRun[] | null; className?: string }) {
  const { t, locale } = useI18n();
  return (
    <section className={cn("grid min-h-0 content-start gap-3", className)} aria-labelledby="jv-runs">
      <h2 id="jv-runs" className="text-sm font-semibold">{t("jarvis.runs.title")}</h2>
      {run ? (
        <div className="grid gap-2 rounded-lg border bg-surface p-3">
          <p className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{t("jarvis.runs.current")}</span>
            <span className="text-muted-foreground">{lookup(t, `command.ai.runStatus.${run.status}`, run.status)}</span>
          </p>
          {run.steps.length ? (
            <ol className="grid gap-1">
              {run.steps.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{lookup(t, `profiles.${s.profile}.name`, s.profile)}</span>
                  <span className={cn("shrink-0", s.status === "BLOCKED" ? "text-danger" : "text-muted-foreground")}>{lookup(t, `jarvis.stepStatus.${s.status}`, s.status)}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {run.nextAction ? <p className="text-xs text-muted-foreground">{t("jarvis.runs.next", { action: run.nextAction })}</p> : null}
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("jarvis.runs.none")}</p>
      )}
      {runs === null ? (
        <p className="text-xs text-muted-foreground">{t("jarvis.runs.noAccess")}</p>
      ) : runs.length ? (
        <ol className="grid gap-2">
          {runs.map((r) => (
            <li key={r.id} className="grid gap-2 rounded-lg border bg-surface/70 p-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium">
                  {r.mine && r.text ? (
                    r.sessionId ? (
                      <Link href={`/${locale}/command?s=${r.sessionId}`} className="hover:underline">
                        {r.text}
                      </Link>
                    ) : (
                      r.text
                    )
                  ) : (
                    t("jarvis.runs.teammate", { team: r.profiles.map((p) => lookup(t, `profiles.${p}.name`, p)).join(", ") })
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground">{lookup(t, `command.ai.runStatus.${r.status}`, r.status)}</span>
              </div>
              <StageRail stages={r.stages} compact />
              {r.pendingApprovals ? <p className="text-[11px] text-warning">{t("jarvis.runs.approvals", { count: r.pendingApprovals })}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">{t("jarvis.runs.empty")}</p>
      )}
    </section>
  );
}
