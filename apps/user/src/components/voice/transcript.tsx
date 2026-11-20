"use client";

import { useMemo, useRef, useState } from "react";
import { Bot, Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { formatDuration } from "./bits";

export interface TranscriptLine {
  role: "agent" | "caller";
  text: string;
  at?: number;
}

/** Transcript viewer: chat-style turns, search with highlights, and (when recorded) click a turn to play from there. */
export function TranscriptViewer({ lines, recordingSrc, agentName }: { lines: TranscriptLine[]; recordingSrc: string | null; agentName: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => (needle ? lines.filter((l) => l.text.toLowerCase().includes(needle)).length : 0), [lines, needle]);
  const mark = (text: string) => {
    if (!needle) return text;
    const parts: (string | { m: string })[] = [];
    let i = 0;
    const lower = text.toLowerCase();
    for (let j = lower.indexOf(needle); j >= 0; j = lower.indexOf(needle, i)) {
      parts.push(text.slice(i, j), { m: text.slice(j, j + needle.length) });
      i = j + needle.length;
    }
    parts.push(text.slice(i));
    return parts.map((p, k) => (typeof p === "string" ? p : <mark key={k} className="rounded-sm bg-warning/30 text-foreground">{p.m}</mark>));
  };
  return (
    <div className="grid gap-3">
      {recordingSrc ? (
        <audio ref={audio} controls preload="none" src={recordingSrc} className="w-full" aria-label={t("voice.call.recording")}>
          <track kind="captions" />
        </audio>
      ) : null}
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("voice.call.searchTranscript")} aria-label={t("voice.call.searchTranscript")} />
        {needle ? <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-live="polite">{t("voice.call.hits", { count: hits })}</span> : null}
      </div>
      <ol className="grid gap-2">
        {lines.map((l, i) => {
          const agent = l.role === "agent";
          const dim = needle && !l.text.toLowerCase().includes(needle);
          return (
            <li key={i} className={cn("flex gap-2", agent ? "" : "flex-row-reverse", dim ? "opacity-40" : "")}>
              <span aria-hidden className={cn("mt-1 grid size-7 shrink-0 place-items-center rounded-full", agent ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>
                {agent ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
              </span>
              <div className={cn("grid max-w-[85%] gap-1 rounded-lg border px-3 py-2 text-sm", agent ? "bg-surface" : "bg-muted/50")}>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium">{agent ? agentName : t("voice.call.caller")}</span>
                  {typeof l.at === "number" ? (
                    recordingSrc ? (
                      <button
                        type="button"
                        className="tabular-nums hover:text-foreground hover:underline"
                        onClick={() => {
                          if (!audio.current) return;
                          audio.current.currentTime = l.at!;
                          void audio.current.play().catch(() => undefined);
                        }}
                        aria-label={t("voice.call.playFrom", { time: formatDuration(l.at) })}
                      >
                        {formatDuration(l.at)}
                      </button>
                    ) : (
                      <span className="tabular-nums">{formatDuration(l.at)}</span>
                    )
                  ) : null}
                </span>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{mark(l.text)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
