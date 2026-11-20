"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, CheckCircle2, Mail, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction } from "../kit";

export interface ActionView {
  kind: string;
  priority: 1 | 2 | 3;
  run: "execute" | "draft" | "link";
  href?: string;
  params: Record<string, string | number>;
}
export interface SubjectView {
  type: "lead" | "deal";
  id: string;
  name: string;
  href: string;
  value: string | null;
  meta: string | null;
  actions: ActionView[];
}

const PRIORITY_TONE = { 1: "danger", 2: "warning", 3: "neutral" } as const;

/** One suggested action with its "why" and a button that does it (or opens the right page). */
export function ActionRow({ base, locale, subject, action, canManage, aiText, compact = false }: { base: string; locale: string; subject: { type: "lead" | "deal"; id: string }; action: ActionView; canManage: boolean; aiText: boolean; compact?: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [done, setDone] = useState<string | null>(null);
  const params = Object.fromEntries(Object.entries(action.params).map(([k, v]) => [k, String(v)]));
  const draftBlocked = action.run === "draft" && !aiText;
  const Icon = action.run === "draft" ? Mail : action.run === "execute" ? Zap : ArrowUpRight;
  return (
    <div className={cn("grid gap-2", compact ? "" : "rounded-lg border bg-surface p-3 shadow-elev-1")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", action.priority === 1 ? "bg-danger/10 text-danger" : action.priority === 2 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
          <Icon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="font-medium leading-snug">{t(`crm.rev.nba.kinds.${action.kind}.title`, params)}</p>
          <p className="text-sm text-muted-foreground">{t(`crm.rev.nba.kinds.${action.kind}.why`, params)}</p>
        </div>
        <Badge tone={PRIORITY_TONE[action.priority]} className="shrink-0">
          {t(`crm.rev.nba.priority.${action.priority}`)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 ps-11">
        {done ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-success" role="status">
            <CheckCircle2 className="size-4" aria-hidden />
            {t(`crm.rev.nba.done.${done}`)}
            {done === "drafted" ? (
              <Link href={`/${locale}/crm/outreach`} className="underline">
                {t("crm.rev.nba.reviewDraft")}
              </Link>
            ) : null}
          </span>
        ) : action.run === "link" ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}${action.href ?? "/crm"}`}>
              {t("crm.rev.nba.open")}
              <ArrowUpRight aria-hidden className="rtl:-scale-x-100" />
            </Link>
          </Button>
        ) : canManage ? (
          draftBlocked ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}${subject.type === "lead" ? `/crm/${subject.id}` : `/crm/deals/${subject.id}`}#outreach`}>
                <Mail aria-hidden />
                {t("crm.rev.nba.writeYourself")}
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant={action.run === "draft" ? "luminous" : "default"}
              disabled={busy}
              aria-busy={busy}
              onClick={() => void run(() => api<{ done: string }>(`${base}/crm/next-actions`, { body: { type: subject.type, id: subject.id, kind: action.kind } }), (r) => setDone(r.done))}
            >
              {action.run === "draft" ? <Sparkles aria-hidden /> : <Zap aria-hidden />}
              {busy ? t("crm.rev.working") : t(action.run === "draft" ? "crm.rev.nba.draftIt" : "crm.rev.nba.doIt")}
            </Button>
          )
        ) : null}
        {action.run === "draft" && !done ? <span className="text-xs text-muted-foreground">{t("crm.rev.nba.draftNote")}</span> : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Ranked list of records with their most important next action (Today page). */
export function NextActionBoard({ base, locale, subjects, canManage, aiText }: { base: string; locale: string; subjects: SubjectView[]; canManage: boolean; aiText: boolean }) {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "lead" | "deal">("all");
  const shown = subjects.filter((s) => filter === "all" || s.type === filter);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("crm.rev.today.filter")}>
        {(["all", "lead", "deal"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn("min-h-9 rounded-full border px-3 text-sm transition-colors", filter === f ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-muted")}
          >
            {t(`crm.rev.today.filters.${f}`)} · {f === "all" ? subjects.length : subjects.filter((s) => s.type === f).length}
          </button>
        ))}
      </div>
      <ol className="grid gap-3">
        {shown.map((s, i) => (
          <li key={`${s.type}:${s.id}`} className="reveal grid gap-2 rounded-xl border bg-surface p-3 shadow-elev-1 sm:p-4" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="font-display text-sm tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <Link href={`/${locale}${s.href}`} className="truncate text-base font-semibold hover:underline">
                  {s.name}
                </Link>
                <Badge tone={s.type === "deal" ? "accent" : "info"}>{t(`crm.rev.today.types.${s.type}`)}</Badge>
              </div>
              <span className="text-sm text-muted-foreground">{[s.meta, s.value].filter(Boolean).join(" · ")}</span>
            </div>
            <ActionRow base={base} locale={locale} subject={s} action={s.actions[0]!} canManage={canManage} aiText={aiText} compact />
            {s.actions.length > 1 ? (
              <details className="ps-11 text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("crm.rev.nba.more", { count: s.actions.length - 1 })}</summary>
                <div className="mt-2 grid gap-3">
                  {s.actions.slice(1).map((a) => (
                    <ActionRow key={a.kind} base={base} locale={locale} subject={s} action={a} canManage={canManage} aiText={aiText} compact />
                  ))}
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
      {!shown.length ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <Bot className="size-4" aria-hidden />
          {t("crm.rev.today.allClear")}
        </p>
      ) : null}
    </div>
  );
}
