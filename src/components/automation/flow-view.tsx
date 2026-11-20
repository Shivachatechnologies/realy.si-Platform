"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Bell, Bot, Brain, CalendarClock, CircleDot, Clock, Filter, GitBranch, Hand, Mail, MousePointerClick, Play, Send, Variable, Webhook, Zap } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { Action, Condition, Definition, Step, Trigger } from "@/server/modules/automation/definition";
import { eventLabelKey } from "./labels";

/**
 * Read-only visual flow of a workflow definition: the trigger at the top, then each step on a glowing spine, in plain
 * language. Branches split into "yes" / "otherwise" lanes. Badges mark AI steps, approvals and anything that leaves
 * the company. Used to review AI- or rule-composed automations before saving, and anywhere a definition is shown.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

const AI_KINDS = new Set(["assign_ai_employee", "ai_employee_task", "generate_ai_content", "decompose_goal", "ai_decision"]);
const EXTERNAL_KINDS = new Set(["send_email", "send_slack", "send_teams", "http_webhook", "custom_api"]);

/** "{{event.data.name}}" → "‹name›" so templates read as plain language. */
export function humanize(text: string | undefined | null): string {
  return (text ?? "").replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_m, p: string) => `‹${p.split(".").slice(-1)[0]!.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}›`);
}

export function triggerText(t: T, trigger: Trigger): string {
  if (trigger.type === "event") return t(eventLabelKey(trigger.event));
  if (trigger.type === "schedule") {
    const s = trigger.schedule;
    if (s.kind === "interval") return t("workflows.flow.everyMinutes", { minutes: s.minutes });
    if (s.kind === "daily") return t("workflows.flow.daily", { time: s.time });
    return t("workflows.flow.weekly", { day: t(`workflows.simple.days.${s.day}`), time: s.time });
  }
  if (trigger.type === "webhook") return t("workflows.builder.triggerTypes.webhook");
  return t("workflows.builder.triggerTypes.manual");
}

function conditionText(t: T, c: Condition) {
  return `${humanize(`{{${c.field}}}`)} ${t(`workflows.builder.ops.${c.op}`)}${c.value ? ` “${humanize(c.value)}”` : ""}`;
}

function actionDetail(t: T, a: Action): string {
  switch (a.kind) {
    case "notify":
      return `${t(`workflows.builder.recipientOptions.${a.recipients}`)} · “${humanize(a.title)}”`;
    case "request_approval":
      return `“${humanize(a.title)}” · ${t(`workflows.builder.approverModes.${a.approverMode}`)}`;
    case "ai_decision":
      return `${humanize(a.question)}`;
    case "assign_ai_employee":
    case "generate_ai_content":
      return `${t(`profiles.${a.profile}.name`)} · ${humanize(a.title)}`;
    case "ai_employee_task":
      return humanize(a.title);
    case "send_email":
      return `${humanize(a.to)} · “${humanize(a.subject)}”`;
    case "send_slack":
      return `#${a.channel} · ${humanize(a.text).slice(0, 80)}`;
    case "send_teams":
      return humanize(a.text).slice(0, 80);
    case "create_task":
      return `“${humanize(a.title)}”${a.dueInDays !== undefined ? ` · ${t("workflows.flow.dueIn", { days: a.dueInDays })}` : ""}`;
    case "assign_round_robin":
      return t(`workflows.builder.pools.${a.pool}`);
    case "assign_user":
    case "update_record":
      return t(`workflows.builder.entities.${a.entity}`);
    case "load_record":
      return t(`workflows.builder.loadEntities.${a.entity}`);
    case "update_lead":
      return a.stage ?? "";
    case "create_meeting":
      return `“${humanize(a.title)}”`;
    case "create_lead":
    case "create_account":
    case "create_deal":
    case "create_project":
      return humanize(a.name);
    case "http_webhook":
      return a.url;
    case "custom_api":
      return `${a.method} ${a.path}`;
    default:
      return "";
  }
}

function actionIcon(a: Action): ReactNode {
  if (a.kind === "ai_decision") return <Brain />;
  if (AI_KINDS.has(a.kind)) return <Bot />;
  if (a.kind === "notify") return <Bell />;
  if (a.kind === "request_approval") return <Hand />;
  if (a.kind === "send_email") return <Mail />;
  if (a.kind === "http_webhook" || a.kind === "custom_api") return <Webhook />;
  if (EXTERNAL_KINDS.has(a.kind)) return <Send />;
  if (a.kind === "create_meeting") return <CalendarClock />;
  return <Zap />;
}

function Node({ icon, title, detail, tone = "default", badges, index, children }: { icon: ReactNode; title: string; detail?: ReactNode; tone?: "trigger" | "default" | "ai" | "approval" | "external" | "logic"; badges?: ReactNode; index: number; children?: ReactNode }) {
  const reduced = useReducedMotion();
  const ring = {
    trigger: "bg-brand-gradient text-primary-foreground shadow-glow",
    default: "bg-surface text-primary border",
    ai: "bg-primary/12 text-primary border border-primary/30",
    approval: "bg-warning/12 text-warning border border-warning/40",
    external: "bg-info/12 text-info border border-info/30",
    logic: "bg-surface-2 text-muted-foreground border",
  }[tone];
  return (
    <motion.li initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
      <span aria-hidden className={cn("relative z-10 grid size-10 place-items-center rounded-full [&_svg]:size-[18px]", ring)}>
        {icon}
      </span>
      <div className="min-w-0 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium">{title}</p>
          {badges}
        </div>
        {detail ? <p className="mt-0.5 text-[13px] leading-snug break-words text-muted-foreground">{detail}</p> : null}
        {children}
      </div>
    </motion.li>
  );
}

function Pill({ tone, children }: { tone: "ai" | "approval" | "external"; children: ReactNode }) {
  const cls = { ai: "bg-primary/10 text-primary", approval: "bg-warning/12 text-warning", external: "bg-info/12 text-info" }[tone];
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase", cls)}>{children}</span>;
}

function StepList({ steps, t, start }: { steps: Step[]; t: T; start: number }) {
  return (
    <ol className="relative grid before:absolute before:start-5 before:top-2 before:bottom-2 before:w-px before:-translate-x-1/2 before:bg-gradient-to-b before:from-primary/50 before:via-border before:to-border rtl:before:translate-x-1/2">
      {steps.map((s, i) => (
        <StepNode key={s.id} step={s} t={t} index={start + i} />
      ))}
    </ol>
  );
}

function StepNode({ step, t, index }: { step: Step; t: T; index: number }) {
  switch (step.type) {
    case "condition":
      return <Node index={index} icon={<Filter />} tone="logic" title={t("workflows.flow.onlyIf")} detail={step.conditions.map((c) => conditionText(t, c)).join(step.match === "all" ? ` ${t("workflows.flow.and")} ` : ` ${t("workflows.flow.or")} `)} />;
    case "branch":
      return (
        <Node index={index} icon={<GitBranch />} tone="logic" title={t("workflows.flow.ifThen")} detail={step.conditions.map((c) => conditionText(t, c)).join(step.match === "all" ? ` ${t("workflows.flow.and")} ` : ` ${t("workflows.flow.or")} `)}>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["then", "else"] as const).map((lane) => (
              <div key={lane} className="rounded-lg border border-dashed p-3">
                <p className={cn("mb-2 text-[11px] font-semibold tracking-wide uppercase", lane === "then" ? "text-success" : "text-muted-foreground")}>{t(lane === "then" ? "workflows.flow.yes" : "workflows.flow.otherwise")}</p>
                {step[lane].length ? <StepList steps={step[lane]} t={t} start={index + 1} /> : <p className="text-xs text-muted-foreground">{t("workflows.flow.nothing")}</p>}
              </div>
            ))}
          </div>
        </Node>
      );
    case "delay":
      return <Node index={index} icon={<Clock />} tone="logic" title={t("workflows.flow.wait", { amount: step.amount, unit: t(`workflows.builder.units.${step.unit}`) })} />;
    case "set_variable":
      return <Node index={index} icon={<Variable />} tone="logic" title={t("workflows.flow.remember", { name: step.name })} detail={humanize(step.value)} />;
    case "action": {
      const a = step.action;
      const ai = AI_KINDS.has(a.kind);
      const external = EXTERNAL_KINDS.has(a.kind);
      const approval = a.kind === "request_approval";
      return (
        <Node
          index={index}
          icon={actionIcon(a)}
          tone={ai ? "ai" : approval ? "approval" : external ? "external" : "default"}
          title={t(`workflows.builder.actions.${a.kind}`)}
          detail={actionDetail(t, a)}
          badges={
            <>
              {ai ? <Pill tone="ai">{t("workflows.flow.badgeAi")}</Pill> : null}
              {approval ? <Pill tone="approval">{t("workflows.flow.badgeApproval")}</Pill> : null}
              {external ? <Pill tone="external">{t("workflows.flow.badgeExternal")}</Pill> : null}
            </>
          }
        >
          {a.kind === "ai_decision" ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {a.options.map((o) => (
                <span key={o} className="rounded-full border px-2 py-0.5 text-xs">
                  {o}
                </span>
              ))}
            </div>
          ) : null}
        </Node>
      );
    }
  }
}

export function FlowView({ definition, className }: { definition: Definition; className?: string }) {
  const { t } = useI18n();
  const trig = definition.trigger;
  const icon = trig.type === "event" ? <Zap /> : trig.type === "schedule" ? <CalendarClock /> : trig.type === "webhook" ? <Webhook /> : <MousePointerClick />;
  return (
    <div className={cn("relative", className)} aria-label={t("workflows.flow.aria")} role="group">
      <ol className="relative grid before:absolute before:start-5 before:top-2 before:bottom-2 before:w-px before:-translate-x-1/2 before:bg-gradient-to-b before:from-primary before:via-primary/40 before:to-border rtl:before:translate-x-1/2">
        <Node index={0} icon={icon} tone="trigger" title={t("workflows.flow.when")} detail={<span className="font-medium text-foreground">{triggerText(t, trig)}</span>} />
        {definition.steps.map((s, i) => (
          <StepNode key={s.id} step={s} t={t} index={i + 1} />
        ))}
        <Node index={definition.steps.length + 1} icon={definition.steps.length ? <CircleDot /> : <Play />} tone="logic" title={t("workflows.flow.done")} />
      </ol>
    </div>
  );
}
