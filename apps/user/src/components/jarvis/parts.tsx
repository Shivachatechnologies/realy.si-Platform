"use client";

import { useRef } from "react";
import { Check, Loader2, Mic, MicOff, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { CoreState } from "./core-state";
import type { VoiceOS, VoiceTurnView } from "./use-voice-os";

/** Always-visible microphone indicator: shown whenever the mic is open (capture) or the wake word is listening. */
export function MicIndicator({ voice, className }: { voice: VoiceOS; className?: string }) {
  const { t } = useI18n();
  if (!voice.micLive) return null;
  const label = voice.phase === "listening" ? t("jarvis.mic.recording") : t("jarvis.mic.wakeListening");
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger", className)}>
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-danger opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-danger" />
      </span>
      <Mic className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** The state of the AI Core in words (the visual is decorative). */
export function CoreStateLabel({ state, className }: { state: CoreState; className?: string }) {
  const { t } = useI18n();
  return (
    <p aria-live="polite" className={cn("text-xs font-semibold uppercase tracking-[0.2em] text-world", className)}>
      {t(`jarvis.state.${state}`)}
    </p>
  );
}

/**
 * Hold to talk (pointer) — or press once to start/stop for keyboard and switch users (hands-free stop on silence).
 */
export function TalkButton({ voice, size = "lg", className }: { voice: VoiceOS; size?: "lg" | "sm"; className?: string }) {
  const { t } = useI18n();
  const pointer = useRef(false);
  const busy = voice.phase === "transcribing" || voice.phase === "thinking";
  const listening = voice.phase === "listening";
  const label = listening ? t("jarvis.talk.release") : busy ? t("jarvis.talk.busy") : t("jarvis.talk.hold");
  return (
    <button
      type="button"
      aria-pressed={listening}
      aria-label={label}
      title={label}
      disabled={busy || !voice.boot}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        pointer.current = true;
        (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
        voice.startTalk("ptt");
      }}
      onPointerUp={() => voice.stopTalk()}
      onPointerCancel={() => voice.cancelTalk()}
      onClick={() => {
        if (pointer.current) {
          pointer.current = false;
          return;
        }
        if (listening) voice.stopTalk();
        else voice.startTalk("toggle");
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "relative grid shrink-0 touch-none select-none place-items-center rounded-full border text-primary-foreground shadow-glow transition-[transform,box-shadow,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-60",
        "bg-[linear-gradient(135deg,var(--primary),var(--primary-2))]",
        listening && "scale-105 bg-danger [background-image:none] shadow-[0_0_0_8px_color-mix(in_oklch,var(--danger)_20%,transparent)]",
        size === "lg" ? "size-20" : "size-12",
        className,
      )}
    >
      {busy ? <Loader2 className={cn("motion-safe:animate-spin", size === "lg" ? "size-8" : "size-5")} aria-hidden /> : listening ? <MicOff className={size === "lg" ? "size-8" : "size-5"} aria-hidden /> : <Mic className={size === "lg" ? "size-8" : "size-5"} aria-hidden />}
      {listening ? <span aria-hidden className="absolute inset-0 rounded-full ring-2 ring-danger/50 motion-safe:animate-ping" /> : null}
    </button>
  );
}

/** Stop speaking / cancel listening. */
export function StopButton({ voice, className }: { voice: VoiceOS; className?: string }) {
  const { t } = useI18n();
  if (!voice.speaking && voice.phase !== "listening") return null;
  return (
    <Button type="button" variant="secondary" size="sm" onClick={voice.stopAll} className={className}>
      <Square aria-hidden />
      {voice.speaking ? t("jarvis.talk.stopSpeaking") : t("jarvis.talk.cancel")}
    </Button>
  );
}

/** Explicit confirmation of a high-impact action: say "approve"/"reject" or click. */
export function ApprovalConfirm({ voice, compact = false }: { voice: VoiceOS; compact?: boolean }) {
  const { t } = useI18n();
  const a = voice.pendingApproval;
  if (!a) return null;
  const canDecide = voice.run?.canDecide ?? false;
  return (
    <div role="alertdialog" aria-label={t("jarvis.confirm.title")} className={cn("grid gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3", compact ? "text-xs" : "text-sm")}>
      <p className="font-semibold">{t("jarvis.confirm.title")}</p>
      <p className="text-muted-foreground">{a.summary}</p>
      <p className="text-xs text-muted-foreground">
        {t("jarvis.confirm.risk", { risk: t(`jarvis.risk.${a.risk}`) })} · {canDecide ? t("jarvis.confirm.howTo") : t("jarvis.confirm.noPermission")}
      </p>
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void voice.decide("approve")}>
            <Check aria-hidden />
            {t("jarvis.confirm.approve")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void voice.decide("reject")}>
            <X aria-hidden />
            {t("jarvis.confirm.reject")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** This page view's conversation (kept in memory; stored only when history is on). */
export function TurnList({ turns, className, max }: { turns: VoiceTurnView[]; className?: string; max?: number }) {
  const { t } = useI18n();
  const shown = max ? turns.slice(-max) : turns;
  if (!shown.length) return null;
  return (
    <ol className={cn("grid gap-2", className)} aria-label={t("jarvis.conversation")}>
      {shown.map((turn) => (
        <li key={turn.id} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
          <div
            className={cn(
              "max-w-[min(36rem,90%)] whitespace-pre-line rounded-2xl px-3 py-2 text-sm",
              turn.role === "user" ? "rounded-ee-sm bg-primary text-primary-foreground" : "rounded-es-sm border bg-surface",
              turn.tone === "warning" && "border-warning/40",
              turn.tone === "danger" && "border-danger/40",
              turn.tone === "success" && "border-success/40",
            )}
          >
            <span className="sr-only">{turn.role === "user" ? t("jarvis.you") : t("jarvis.realy")}: </span>
            {turn.text.length > 1500 ? `${turn.text.slice(0, 1500)}…` : turn.text}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Notices from the controller (mic denied, provider fallback, nothing heard…). */
export function VoiceNotice({ voice }: { voice: VoiceOS }) {
  const { t } = useI18n();
  if (!voice.notice) return null;
  return (
    <p role="status" className={cn("text-xs", voice.notice.tone === "danger" ? "text-danger" : voice.notice.tone === "warning" ? "text-warning" : "text-muted-foreground")}>
      {t(`jarvis.notice.${voice.notice.key}`)}
    </p>
  );
}
