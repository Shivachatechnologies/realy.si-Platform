"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Maximize2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { audioEngine } from "./audio-engine";
import { deriveCoreState } from "./core-state";
import { JarvisCoreSvg } from "./jarvis-core-svg";
import { ApprovalConfirm, CoreStateLabel, MicIndicator, StopButton, TalkButton, TurnList, VoiceNotice } from "./parts";
import { useVoiceOS, WAKE_KEY } from "./use-voice-os";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

const level = () => audioEngine.level();
const noop = () => () => {};

function readCookie(name: string): string | null {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  const v = m ? decodeURIComponent(m.slice(name.length + 1)) : null;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/**
 * The active company's API base for the dock (which sits in the app frame, outside the page's scope providers):
 * the same choice as the top bar — the workspace cookies, else the first organization and company.
 */
function useCompanyBase(active: boolean): string | null {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    (async () => {
      let org = readCookie("realy_org");
      if (!org) {
        const me = await api<{ organizations: { id: string }[] }>("/api/v1/me");
        org = me.organizations[0]?.id ?? null;
      }
      if (!org) return;
      let company = readCookie("realy_company");
      if (!company) {
        const list = await api<{ data: { id: string }[] }>(`/api/v1/organizations/${org}/companies?limit=1`);
        company = list.data[0]?.id ?? null;
      }
      if (!stop && company) setBase(`/api/v1/organizations/${org}/companies/${company}`);
    })().catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [active]);
  return base;
}

/**
 * Global Realy voice dock (every app page except the full console): a compact AI Core that opens a small voice panel
 * — push-to-talk, typed commands, spoken answers, approval confirmation. Nothing loads or listens until the person
 * opens it, unless they switched on the "Hey Realy" wake word.
 */
export function JarvisDock() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const wakeArmed = useSyncExternalStore(
    noop,
    () => {
      try {
        return window.localStorage.getItem(WAKE_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const [text, setText] = useState("");
  const onConsole = /^\/[^/]+\/realy(\/|$)/.test(pathname ?? "");
  const active = !onConsole && (used || wakeArmed);
  const base = useCompanyBase(active);
  const voice = useVoiceOS({ base, enabled: active, spaceToTalk: open && !onConsole, path: pathname ?? undefined });
  const [, setTick] = useState(0);

  useEffect(() => {
    const until = Math.max(voice.flash.alertUntil, voice.flash.successUntil);
    const wait = until - Date.now();
    if (wait <= 0) return;
    const id = setTimeout(() => setTick((n) => n + 1), wait + 30);
    return () => clearTimeout(id);
  }, [voice.flash]);

  // Open the panel while the person is talking to Realy (e.g. after "Hey Realy").
  const talking = voice.phase !== "idle" || voice.speaking || !!voice.pendingApproval;
  const [prevTalking, setPrevTalking] = useState(false);
  if (talking !== prevTalking) {
    setPrevTalking(talking);
    if (talking && !open) setOpen(true);
  }

  if (onConsole) return null;

  const state = deriveCoreState({
    listening: voice.phase === "listening",
    thinking: voice.phase === "transcribing" || voice.phase === "thinking",
    speaking: voice.speaking,
    executing: !!voice.run?.open,
    alertUntil: voice.flash.alertUntil,
    successUntil: voice.flash.successUntil,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (v.length < 2) return;
    voice.sendText(v);
    setText("");
  };
  const lastAssistant = [...voice.turns].reverse().find((x) => x.role === "assistant");

  return (
    <div className="pointer-events-none fixed end-4 bottom-[calc(8.75rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2 lg:end-5 lg:bottom-[5.5rem]">
      {open ? (
        <section
          role="dialog"
          aria-label={t("jarvis.dock.title")}
          className="glass-strong pointer-events-auto grid w-[min(22rem,calc(100vw-2rem))] gap-3 rounded-2xl border p-3 shadow-elev-4 animate-fade-in"
        >
          <header className="flex items-center gap-2">
            <div className="size-9 shrink-0">
              <JarvisCoreSvg state={state} level={level} pulses={{}} activity={0} reducedMotion={reduced} compact />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("jarvis.dock.title")}</p>
              <CoreStateLabel state={state} className="text-[10px] tracking-[0.15em]" />
            </div>
            <Link href={`/${locale}/realy`} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("jarvis.dock.openConsole")} title={t("jarvis.dock.openConsole")}>
              <Maximize2 className="size-4" aria-hidden />
            </Link>
            <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <MicIndicator voice={voice} className="justify-self-start" />
          {!base ? <p className="text-xs text-muted-foreground">{t("jarvis.dock.loading")}</p> : null}
          {voice.bootError ? <FormError error={voice.bootError} /> : null}
          <p aria-live="polite" className="min-h-[2.5rem] text-sm text-muted-foreground">
            {voice.phase === "listening" || voice.phase === "transcribing"
              ? voice.interim || t("jarvis.caption.listening")
              : voice.phase === "thinking"
                ? t("jarvis.caption.thinking")
                : lastAssistant
                  ? lastAssistant.text.length > 280
                    ? `${lastAssistant.text.slice(0, 280)}…`
                    : lastAssistant.text
                  : t("jarvis.dock.hint")}
          </p>
          <ApprovalConfirm voice={voice} compact />
          <TurnList turns={voice.turns.filter((x) => x.role === "user")} max={2} />
          <div className="flex items-center gap-2">
            <TalkButton voice={voice} size="sm" />
            <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1.5">
              <label htmlFor="jv-dock-text" className="sr-only">{t("jarvis.typeLabel")}</label>
              <input
                id="jv-dock-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                autoComplete="off"
                placeholder={t("jarvis.typePlaceholder")}
                className="h-10 min-w-0 flex-1 rounded-full border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
              />
              <Button type="submit" size="icon" variant="secondary" aria-label={t("jarvis.send")} disabled={text.trim().length < 2 || !voice.boot}>
                <Send aria-hidden className="rtl:-scale-x-100" />
              </Button>
            </form>
          </div>
          <div className="flex items-center justify-between gap-2">
            <StopButton voice={voice} />
            <p className="text-[11px] text-muted-foreground">{t("jarvis.dock.spaceHint")}</p>
          </div>
          <VoiceNotice voice={voice} />
          {voice.error ? <FormError error={voice.error} /> : null}
        </section>
      ) : null}
      <div className="pointer-events-auto flex items-center gap-2">
        {!open ? <MicIndicator voice={voice} className="glass-strong" /> : null}
        <button
          type="button"
          onClick={() => {
            setUsed(true);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-label={open ? t("jarvis.dock.close") : t("jarvis.dock.open")}
          title={open ? t("jarvis.dock.close") : t("jarvis.dock.open")}
          className={cn(
            "glass-strong grid size-14 place-items-center rounded-full border shadow-elev-3 transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none",
            voice.micLive && "ring-2 ring-danger/60",
          )}
        >
          <span className="size-11">
            <JarvisCoreSvg state={state} level={level} pulses={{}} activity={0} reducedMotion={reduced} compact />
          </span>
        </button>
      </div>
    </div>
  );
}
