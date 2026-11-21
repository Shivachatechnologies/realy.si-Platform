"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { Keyboard, Send, Settings2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { ALERT_EVENTS, DEPARTMENTS, SUCCESS_EVENTS } from "@/server/modules/voiceos/catalog";
import type { VoiceBootstrap } from "@/server/modules/voiceos/service";
import { audioEngine } from "./audio-engine";
import { deriveCoreState } from "./core-state";
import { JarvisCore } from "./jarvis-core";
import { EventFeed, RunsPanel } from "./panels";
import { ApprovalConfirm, CoreStateLabel, MicIndicator, StopButton, TalkButton, TurnList, VoiceNotice } from "./parts";
import { VoiceSettingsPanel } from "./settings-panel";
import { useCompanyEvents, type StreamItem } from "./use-company-events";
import { useVoiceOS } from "./use-voice-os";

const OPEN = new Set(["PLANNED", "RUNNING", "REVIEWING"]);
const level = () => audioEngine.level();

/**
 * The Realy voice console (/realy): the AI Core in the centre, driven by the microphone, the voice output, the
 * conversation's command run and the company's live event stream; push-to-talk (hold Space or the button),
 * keyboard fallback, explicit approval confirmation, the live company stream and active command runs.
 */
export function JarvisConsole({ base, companyName, initialEvents }: { base: string; companyName: string; initialEvents: StreamItem[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const voice = useVoiceOS({ base, spaceToTalk: true, path: pathname });
  const [runs, setRuns] = useState<VoiceBootstrap["runs"]>(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [, setTick] = useState(0);
  const { flashAlert, flashSuccess, poke, refresh } = voice;
  const followedRunId = voice.run?.id ?? null;

  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  // Live runs come with each bootstrap (re-fetched when the stream reports a run the list does not know yet).
  const bootRuns = voice.boot?.runs;
  const [seenBoot, setSeenBoot] = useState<VoiceBootstrap["runs"] | undefined>(undefined);
  if (bootRuns !== undefined && bootRuns !== seenBoot) {
    setSeenBoot(bootRuns);
    setRuns(bootRuns);
  }

  const onItem = useCallback(
    (item: StreamItem) => {
      if (item.kind === "domain") {
        if (ALERT_EVENTS.includes(item.type)) flashAlert();
        else if (SUCCESS_EVENTS.includes(item.type)) flashSuccess();
      }
      if (item.kind === "task" && item.status === "FAILED") flashAlert();
      if (item.kind === "approval" && item.status === "PENDING") flashAlert();
      if (item.kind === "run") {
        if (item.id === followedRunId) void poke();
        const known = runsRef.current?.some((r) => r.id === item.id);
        if (known) setRuns((prev) => prev?.map((r) => (r.id === item.id ? { ...r, status: item.status } : r)) ?? prev);
        else if (runsRef.current) refresh();
      }
      if (item.kind === "approval" || item.kind === "task") void poke();
    },
    [flashAlert, flashSuccess, poke, refresh, followedRunId],
  );
  const stream = useCompanyEvents(base, { onItem });
  const feed = useMemo(() => {
    const keys = new Set(stream.items.map((i) => i.key));
    return [...stream.items, ...initialEvents.filter((i) => !keys.has(i.key))];
  }, [stream.items, initialEvents]);

  const openRuns = (runs ?? []).filter((r) => OPEN.has(r.status)).length;
  const executing = !!voice.run?.open || openRuns > 0;
  const state = deriveCoreState({
    listening: voice.phase === "listening",
    thinking: voice.phase === "transcribing" || voice.phase === "thinking",
    speaking: voice.speaking,
    executing,
    alertUntil: voice.flash.alertUntil,
    successUntil: voice.flash.successUntil,
  });

  // Re-render when an ALERT/SUCCESS flash ends.
  useEffect(() => {
    const until = Math.max(voice.flash.alertUntil, voice.flash.successUntil);
    const wait = until - Date.now();
    if (wait <= 0) return;
    const id = setTimeout(() => setTick((n) => n + 1), wait + 30);
    return () => clearTimeout(id);
  }, [voice.flash]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (v.length < 2) return;
    voice.sendText(v);
    setText("");
  };
  const lastAssistant = [...voice.turns].reverse().find((x) => x.role === "assistant");
  const caption = voice.phase === "listening" || voice.phase === "transcribing" ? voice.interim || t("jarvis.caption.listening") : voice.phase === "thinking" ? t("jarvis.caption.thinking") : (lastAssistant?.text ?? t("jarvis.caption.idle", { company: companyName }));

  return (
    <div className="grid gap-4 lg:min-h-[calc(100dvh-8.5rem)] lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_minmax(0,21rem)]">
      <EventFeed items={feed} status={stream.status} className="order-3 lg:order-1 lg:max-h-[calc(100dvh-8.5rem)] lg:overflow-y-auto lg:pe-1" />

      <section className="order-1 grid content-start justify-items-center gap-3 lg:order-2" aria-labelledby="jv-title">
        <header className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="eyebrow-rule text-xs font-medium text-world">{t("jarvis.eyebrow")}</p>
            <h1 id="jv-title" className="font-display text-2xl tracking-tight sm:text-3xl">{t("jarvis.title")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <MicIndicator voice={voice} />
            <Button type="button" variant="ghost" size="icon" aria-pressed={voice.muted} aria-label={voice.muted ? t("jarvis.unmute") : t("jarvis.mute")} title={voice.muted ? t("jarvis.unmute") : t("jarvis.mute")} onClick={() => voice.setMuted(!voice.muted)}>
              {voice.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="secondary" size="sm" disabled={!voice.boot}>
                  <Settings2 aria-hidden />
                  {t("jarvis.settings.open")}
                </Button>
              </DialogTrigger>
              <DialogContent title={t("jarvis.settings.title")} description={t("jarvis.settings.description")} closeLabel={t("common.close")}>
                <VoiceSettingsPanel voice={voice} base={base} />
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {voice.bootError ? <FormError error={voice.bootError} /> : null}
        {voice.boot && !voice.boot.ai.configured ? <Notice tone="warning">{t("jarvis.aiNotConfigured")}</Notice> : null}
        {voice.boot && voice.boot.ai.configured && !voice.boot.ai.canRun ? <Notice tone="warning">{t("jarvis.cannotRun")}</Notice> : null}

        <div className="relative isolate aspect-square w-full max-w-[min(34rem,62vh)]">
          <div aria-hidden className="jv-grid rounded-full [mask-image:radial-gradient(circle,#000_30%,transparent_70%)]" />
          <div aria-hidden className="absolute inset-[4%] -z-10 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--jarvis-cyan)_14%,transparent),transparent_68%)]" />
          <JarvisCore state={state} level={level} pulses={stream.pulses} activity={Math.min(1, openRuns / 4)} priority={4} className="absolute inset-0" />
          <ul className="sr-only">
            {DEPARTMENTS.map((d) => (
              <li key={d}>{t(`jarvis.departments.${d}`)}</li>
            ))}
          </ul>
        </div>
        <CoreStateLabel state={state} />
        <p aria-live="polite" className={cn("min-h-[3rem] max-w-2xl text-center text-base leading-relaxed text-balance", voice.phase === "listening" ? "text-foreground" : "text-muted-foreground")}>
          {caption.length > 420 ? `${caption.slice(0, 420)}…` : caption}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <TalkButton voice={voice} />
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">{t("jarvis.talk.spaceHint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <StopButton voice={voice} />
              <Button type="button" variant="ghost" size="sm" aria-expanded={typing} onClick={() => setTyping((v) => !v)}>
                <Keyboard aria-hidden />
                {t("jarvis.type")}
              </Button>
              {voice.recognitionAvailable && voice.settings ? (
                <Button type="button" variant={voice.settings.wakeWordEnabled ? "soft" : "ghost"} size="sm" aria-pressed={voice.settings.wakeWordEnabled} onClick={() => void voice.updateSettings({ wakeWordEnabled: !voice.settings!.wakeWordEnabled })}>
                  {voice.settings.wakeWordEnabled ? t("jarvis.wake.on") : t("jarvis.wake.off")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <VoiceNotice voice={voice} />
        {voice.error ? <FormError error={voice.error} /> : null}

        {typing ? (
          <form onSubmit={submit} className="flex w-full max-w-2xl items-center gap-2">
            <label htmlFor="jv-text" className="sr-only">{t("jarvis.typeLabel")}</label>
            <input
              id="jv-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              autoComplete="off"
              placeholder={t("jarvis.typePlaceholder")}
              className="h-11 min-w-0 flex-1 rounded-full border bg-surface px-4 text-sm focus-visible:outline-2 focus-visible:outline-primary"
            />
            <Button type="submit" size="icon" aria-label={t("jarvis.send")} disabled={text.trim().length < 2 || voice.phase === "thinking"}>
              <Send aria-hidden className="rtl:-scale-x-100" />
            </Button>
          </form>
        ) : null}

        <div className="w-full max-w-2xl">
          <ApprovalConfirm voice={voice} />
        </div>

        {voice.boot?.suggestions.length ? (
          <div className="grid w-full max-w-2xl gap-2">
            <p className="text-xs font-medium text-muted-foreground">{t("jarvis.quick")}</p>
            <div className="flex flex-wrap gap-2">
              {voice.boot.suggestions.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={voice.phase !== "idle"}
                  onClick={() => voice.sendText(t(`guide.command.suggest.${k}`))}
                  className="min-h-9 rounded-full border bg-surface px-3 text-xs hover:border-primary/40 hover:text-primary disabled:opacity-50 pointer-coarse:min-h-11"
                >
                  {t(`guide.command.suggest.${k}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <TurnList turns={voice.turns} className="w-full max-w-2xl" />
        <p className="max-w-2xl text-center text-[11px] text-muted-foreground">
          {voice.settings?.historyEnabled ? t("jarvis.privacy.historyOn") : t("jarvis.privacy.historyOff")} {voice.providerStt ? t("jarvis.privacy.provider") : t("jarvis.privacy.browser")}
        </p>
      </section>

      <RunsPanel run={voice.run} runs={runs} className="order-2 lg:order-3 lg:max-h-[calc(100dvh-8.5rem)] lg:overflow-y-auto lg:ps-1" />
    </div>
  );
}
