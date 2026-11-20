"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/**
 * Voice input through the browser's Web Speech API (progressive enhancement): renders nothing where unsupported.
 * Final transcripts are passed to `onText`; interim text to `onInterim` (optional).
 */
export function MicButton({ onText, onInterim, className }: { onText: (text: string) => void; onInterim?: (text: string) => void; className?: string }) {
  const { t, locale } = useI18n();
  const supported = useSyncExternalStore(noop, () => speechCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = locale;
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) onInterim?.(interim);
      if (finalText) onText(finalText.trim());
    };
    r.onend = () => {
      setListening(false);
      onInterim?.("");
    };
    r.onerror = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? t("guide.voice.stop") : t("guide.voice.start")}
      title={listening ? t("guide.voice.stop") : t("guide.voice.start")}
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-md border bg-surface text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary",
        listening && "border-danger/50 text-danger",
        className,
      )}
    >
      {listening ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
      {listening ? <span aria-hidden className="absolute inset-0 rounded-md ring-2 ring-danger/40 motion-safe:animate-pulse" /> : null}
    </button>
  );
}
