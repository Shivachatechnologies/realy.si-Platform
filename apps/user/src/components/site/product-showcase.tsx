"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Check, CheckSquare, ClipboardCheck, FileText, LayoutDashboard, Brain, Handshake, ShieldAlert, Sparkles, Users, X, type LucideIcon } from "lucide-react";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

type TabKey = "command" | "approvals" | "workforce" | "brain" | "pipeline";
const TABS: { key: TabKey; icon: LucideIcon }[] = [
  { key: "command", icon: LayoutDashboard },
  { key: "approvals", icon: ClipboardCheck },
  { key: "workforce", icon: Users },
  { key: "brain", icon: Brain },
  { key: "pipeline", icon: Handshake },
];

/** A window-chrome frame for the illustrative previews. */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-surface shadow-float">
      <div className="flex h-10 items-center gap-2 border-b bg-muted/40 px-4">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </span>
        <span className="mx-auto truncate text-[11.5px] font-medium text-muted-foreground">{title}</span>
        <span aria-hidden className="w-10" />
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
}

function Bar({ w, className }: { w: string; className?: string }) {
  return <span aria-hidden className={cn("block h-2 rounded-full bg-muted", className)} style={{ width: w }} />;
}

function CommandPreview() {
  const { t } = useI18n();
  const rows = [
    { label: t("site.showcase.preview.cmd1"), status: t("site.showcase.preview.statusWaiting"), tone: "bg-warning" },
    { label: t("site.showcase.preview.cmd2"), status: t("site.showcase.preview.statusRunning"), tone: "bg-primary" },
    { label: t("site.showcase.preview.cmd3"), status: t("site.showcase.preview.statusDone"), tone: "bg-success" },
  ];
  return (
    <div className="grid gap-4">
      <p className="font-display text-2xl">{t("site.showcase.preview.greeting")}</p>
      <div className="flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-gradient text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{t("site.showcase.preview.commandPrompt")}</span>
        <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
          <ArrowUp className="size-4" />
        </span>
      </div>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", r.tone)} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{r.label}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalsPreview() {
  const { t } = useI18n();
  const items = [
    { title: t("site.showcase.preview.ap1"), who: t("profiles.sdr.name"), risk: t("site.showcase.preview.riskHigh"), high: true },
    { title: t("site.showcase.preview.ap2"), who: t("profiles.bookkeeper.name"), risk: t("site.showcase.preview.riskMedium"), high: false },
  ];
  return (
    <ul className="grid gap-3">
      {items.map((i) => (
        <li key={i.title} className="grid gap-3 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <AiAvatar seed={i.who} size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{i.title}</p>
              <p className="text-[12px] text-muted-foreground">{t("site.showcase.preview.proposedBy", { name: i.who })}</p>
            </div>
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", i.high ? "bg-danger/12 text-danger" : "bg-warning/15 text-warning")}>
              <ShieldAlert className="size-3" aria-hidden />
              {i.risk}
            </span>
          </div>
          <div className="grid gap-1.5 rounded-lg bg-muted/50 p-3">
            <Bar w="92%" />
            <Bar w="76%" />
            <Bar w="54%" />
          </div>
          <div className="flex gap-2">
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[12.5px] font-medium text-background">
              <Check className="size-3.5" aria-hidden />
              {t("site.showcase.preview.approve")}
            </span>
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px]">
              <X className="size-3.5" aria-hidden />
              {t("site.showcase.preview.reject")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function WorkforcePreview() {
  const { t } = useI18n();
  const reports = [
    { key: "cmo", dept: "marketing" },
    { key: "ai_cfo", dept: "finance" },
    { key: "sales_manager", dept: "sales" },
  ];
  return (
    <div className="grid justify-items-center gap-5">
      <div className="flex items-center gap-3 rounded-2xl border bg-background/60 px-4 py-3 shadow-elev-1">
        <AiAvatar seed="ai_ceo" department="executive" size={40} active />
        <div>
          <p className="text-sm font-medium">{t("profiles.ai_ceo.name")}</p>
          <p className="text-[11.5px] text-muted-foreground">{t("site.showcase.preview.reportsToYou")}</p>
        </div>
      </div>
      <svg aria-hidden viewBox="0 0 300 30" className="-my-3 h-8 w-full max-w-sm text-border-strong" preserveAspectRatio="none">
        <path d="M150 0v12M50 30V18h200v12M150 12v18" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <ul className="grid w-full grid-cols-3 gap-2">
        {reports.map((r) => (
          <li key={r.key} className="grid justify-items-center gap-2 rounded-xl border p-3 text-center">
            <AiAvatar seed={r.key} department={r.dept} size={36} />
            <p className="line-clamp-2 text-[12px] leading-tight font-medium">{t(`profiles.${r.key}.name`)}</p>
          </li>
        ))}
      </ul>
      <p className="text-center text-[12px] text-muted-foreground">{t("site.showcase.preview.delegation")}</p>
    </div>
  );
}

function BrainPreview() {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-foreground px-4 py-2.5 text-[13px] text-background">{t("site.showcase.preview.brainQ")}</div>
      <div className="max-w-[92%] rounded-2xl rounded-es-md border bg-background/60 p-4">
        <p className="text-[13px] leading-relaxed">{t("site.showcase.preview.brainA")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[t("site.showcase.preview.source1"), t("site.showcase.preview.source2")].map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              <FileText className="size-3" aria-hidden />
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PipelinePreview() {
  const { t } = useI18n();
  const stages = ["lead", "qualified", "proposal", "won"] as const;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stages.map((s, i) => (
        <div key={s} className="grid content-start gap-2 rounded-xl bg-muted/40 p-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
            <span aria-hidden className={cn("size-1.5 rounded-full", i === 3 ? "bg-success" : "bg-primary")} />
            {t(`site.showcase.preview.stages.${s}`)}
          </p>
          {Array.from({ length: 3 - Math.min(i, 2) }).map((_, j) => (
            <div key={j} className="grid gap-1.5 rounded-lg border bg-surface p-2.5 shadow-elev-1">
              <Bar w="80%" className="bg-border-strong/60" />
              <Bar w="55%" />
              {i === 2 && j === 0 ? (
                <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-primary">
                  <CheckSquare className="size-3" aria-hidden />
                  {t("site.showcase.preview.aiDraft")}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const PREVIEWS: Record<TabKey, () => ReactNode> = {
  command: CommandPreview,
  approvals: ApprovalsPreview,
  workforce: WorkforcePreview,
  brain: BrainPreview,
  pipeline: PipelinePreview,
};

/**
 * Interactive product tour: accessible tabs (arrow keys) switching between illustrative previews of real product
 * surfaces. Previews carry no real or invented figures — a visible note says so.
 */
export function ProductShowcase() {
  const { t } = useI18n();
  const id = useId();
  const reduced = useReducedMotion();
  const [active, setActive] = useState<TabKey>("command");
  const Preview = PREVIEWS[active];

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const dir = document.documentElement.dir === "rtl" ? -1 : 1;
    const next =
      e.key === "ArrowRight" ? i + dir : e.key === "ArrowLeft" ? i - dir : e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const tab = TABS[(next + TABS.length) % TABS.length]!;
    setActive(tab.key);
    document.getElementById(`${id}-tab-${tab.key}`)?.focus();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
      <div role="tablist" aria-label={t("site.showcase.title")} className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:overflow-visible lg:px-0">
        {TABS.map((tab, i) => {
          const selected = tab.key === active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              id={`${id}-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "group relative flex min-h-12 shrink-0 snap-start items-start gap-3 rounded-2xl border px-4 py-3 text-start transition-[background-color,border-color,box-shadow] lg:min-h-0",
                selected ? "border-border-strong bg-surface shadow-elev-2" : "border-transparent hover:bg-muted/50",
              )}
            >
              <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg transition-colors", selected ? "bg-brand-gradient text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="grid gap-1">
                <span className="text-[14px] font-medium whitespace-nowrap lg:whitespace-normal">{t(`site.showcase.tabs.${tab.key}.label`)}</span>
                <span className={cn("hidden text-[13px] leading-relaxed text-muted-foreground lg:block", !selected && "lg:line-clamp-1")}>{t(`site.showcase.tabs.${tab.key}.body`)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`} className="grid gap-3">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground lg:hidden">{t(`site.showcase.tabs.${active}.body`)}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={reduced ? false : { opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.985 }}
            transition={{ duration: reduced ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <Frame title={t(`site.showcase.tabs.${active}.label`)}>
              <Preview />
            </Frame>
          </motion.div>
        </AnimatePresence>
        <p className="text-center text-[11.5px] text-muted-foreground">{t("site.showcase.preview.note")}</p>
      </div>
    </div>
  );
}
