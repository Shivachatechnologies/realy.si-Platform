"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import type { VoiceBootstrap } from "@/server/modules/voiceos/service";
import type { VoiceSettingsView } from "@/server/modules/voiceos/access";
import { personalityOf, STOP_WORDS, WAKE_PHRASES, isVoiceLanguage, type VoiceLanguage } from "@/server/modules/voiceos/catalog";
import { audioEngine } from "./audio-engine";
import { pickSystemVoice, readResults, recognitionCtor, synthesisSupported, type SpeechRecognitionLike } from "./browser-speech";

export type Phase = "idle" | "listening" | "transcribing" | "thinking";
export type TalkMode = "ptt" | "toggle" | "wake";

export interface VoiceTurnView {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone?: "info" | "warning" | "danger" | "success";
  provider?: string;
}

export interface FollowedRun {
  id: string;
  status: string;
  open: boolean;
  running: number;
  answer: string | null;
  spoken: string | null;
  nextAction: string | null;
  failedReason: string | null;
  canDecide: boolean;
  approvals: { id: string; tool: string; summary: string; risk: string }[];
  profiles: string[];
  steps: { id: string; kind: string; profile: string; status: string; errorReason: string | null }[];
}

interface UtterResult {
  commandSessionId: string;
  run: { id: string; status: string; profiles: string[]; steps: FollowedRun["steps"] } | null;
  reply: { key: string; params: Record<string, string | number> };
  open: boolean;
}

/** localStorage key mirroring the wake-word preference (convenience only; the server setting is the source of truth). */
export const WAKE_KEY = "realy.voice.wake";
const VAD_THRESHOLD = 0.06;
const SEGMENT_SILENCE_MS = 650;
const HANDSFREE_SILENCE_MS = 1_400;
const HANDSFREE_NO_SPEECH_MS = 7_000;
const MAX_CAPTURE_MS = 60_000;
const POLL_MS = 2_500;

const isEditable = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return n.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(n.tagName);
};

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported(m)) return m;
  return undefined;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:"'“”‘’。，！？؟،।]/g, " ").replace(/\s+/g, " ").trim();

const noopSubscribe = () => () => {};
const subscribeAudio = (cb: () => void) => audioEngine.subscribe(cb);
const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

/**
 * The Voice OS controller: push-to-talk / hands-free capture with phrase-level streaming transcription (each phrase
 * is sent to the company's STT provider as soon as the speaker pauses; browser recognition when no provider is
 * connected), every utterance routed into AI Command, run follow-up with spoken answers, explicit confirmation of
 * approvals, TTS with barge-in, and the opt-in "Hey Realy" wake word (visible tab only). The microphone is open only
 * while capturing or while the person has the wake word switched on — always shown by `micLive`.
 */
export function useVoiceOS({ base, enabled = true, spaceToTalk = false, path }: { base: string | null; enabled?: boolean; spaceToTalk?: boolean; path?: string }) {
  const { t, locale } = useI18n();
  const [boot, setBoot] = useState<VoiceBootstrap | null>(null);
  const [bootError, setBootError] = useState<unknown>(null);
  const [settings, setSettings] = useState<VoiceSettingsView | null>(null);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<VoiceTurnView[]>([]);
  const [run, setRun] = useState<FollowedRun | null>(null);
  const [pendingApproval, setPendingApproval] = useState<FollowedRun["approvals"][number] | null>(null);
  const [notice, setNotice] = useState<{ key: string; tone: "info" | "warning" | "danger" } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [muted, setMuted] = useState(false);
  const [wakeListening, setWakeListening] = useState(false);
  const [flash, setFlash] = useState({ alertUntil: 0, successUntil: 0 });
  const [bootKey, setBootKey] = useState(0);

  const speaking = useSyncExternalStore(subscribeAudio, () => audioEngine.playing, () => false);
  const micOpen = useSyncExternalStore(subscribeAudio, () => audioEngine.micOpen, () => false);
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => true);
  const recognitionAvailable = useSyncExternalStore(noopSubscribe, () => recognitionCtor() !== null, () => false);

  const r = useRef({
    sessionId: null as string | null,
    phase: "idle" as Phase,
    mode: null as TalkMode | null,
    capturing: false,
    recorder: null as MediaRecorder | null,
    segStart: 0,
    segSpeech: false,
    captureStart: 0,
    lastVoice: 0,
    hadSpeech: false,
    vad: null as ReturnType<typeof setInterval> | null,
    segments: [] as Promise<string>[],
    segTexts: [] as (string | null)[],
    browserRec: null as SpeechRecognitionLike | null,
    browserText: "",
    browserDone: null as (() => void) | null,
    browserEnded: false,
    sttFailed: false,
    ttsFailed: false,
    announced: new Set<string>(),
    runId: null as string | null,
    pollTimer: null as ReturnType<typeof setTimeout> | null,
    wake: null as SpeechRecognitionLike | null,
    wakeWanted: false,
    wakeErrors: 0,
  });
  const latest = useRef({ boot, settings, muted, pendingApproval, t, path });
  useEffect(() => {
    latest.current = { boot, settings, muted, pendingApproval, t, path };
  });

  const setPhase = useCallback((p: Phase) => {
    r.current.phase = p;
    setPhaseState(p);
  }, []);
  const lang = (): VoiceLanguage => {
    const l = latest.current.settings?.language;
    return isVoiceLanguage(l) ? l : isVoiceLanguage(locale) ? locale : "en-US";
  };
  const addTurn = useCallback((turn: Omit<VoiceTurnView, "id">) => {
    setTurns((prev) => [...prev, { ...turn, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }].slice(-60));
  }, []);
  const flashAlert = useCallback(() => setFlash((f) => ({ ...f, alertUntil: Date.now() + 2_600 })), []);
  const flashSuccess = useCallback(() => setFlash((f) => ({ ...f, successUntil: Date.now() + 2_200 })), []);

  // ───── Bootstrap ─────
  useEffect(() => {
    if (!base || !enabled) return;
    let stop = false;
    api<VoiceBootstrap>(`${base}/voiceos?locale=${encodeURIComponent(locale)}`)
      .then((d) => {
        if (stop) return;
        setBoot(d);
        setSettings(d.settings);
        setBootError(null);
      })
      .catch((e: unknown) => !stop && setBootError(e));
    return () => {
      stop = true;
    };
  }, [base, enabled, locale, bootKey]);
  const refresh = useCallback(() => setBootKey((k) => k + 1), []);

  // Per-browser mirror of the wake-word choice, so the global dock can arm "Hey Realy" without a request per page.
  useEffect(() => {
    if (!settings) return;
    try {
      window.localStorage.setItem(WAKE_KEY, settings.wakeWordEnabled ? "1" : "0");
    } catch {
      /* storage unavailable: the dock arms the wake word once opened */
    }
  }, [settings]);

  const updateSettings = useCallback(
    async (patch: Partial<VoiceSettingsView>) => {
      if (!base) return;
      setSettings((s) => (s ? { ...s, ...patch } : s));
      try {
        const next = await api<VoiceSettingsView>(`${base}/voiceos/settings`, { method: "PATCH", body: patch });
        setSettings(next);
      } catch (e) {
        setError(e);
        refresh();
      }
    },
    [base, refresh],
  );

  const ensureSession = useCallback(async (): Promise<string> => {
    if (r.current.sessionId) return r.current.sessionId;
    const s = latest.current.settings;
    const created = await api<{ id: string }>(`${base}/voiceos/sessions`, { body: { language: s?.language ?? locale, personality: s?.personality } });
    r.current.sessionId = created.id;
    return created.id;
  }, [base, locale]);

  // ───── Speech output ─────
  const canProviderTts = () => {
    const { boot: b, settings: s } = latest.current;
    if (!b || !s || s.ttsProvider === "browser" || r.current.ttsFailed || !b.minutes.allowed) return false;
    return s.ttsProvider === "auto" ? b.providers.tts.length > 0 : (b.providers.tts as string[]).includes(s.ttsProvider);
  };

  const speakBrowser = useCallback((text: string) => {
    if (!synthesisSupported()) return;
    const s = latest.current.settings;
    const persona = personalityOf(s?.personality);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang();
    const v = pickSystemVoice(u.lang, persona.browserGender);
    if (v) u.voice = v;
    u.rate = persona.rate;
    u.pitch = persona.pitch;
    u.onstart = () => audioEngine.setPlaying(true);
    u.onboundary = () => audioEngine.speechPulse(0.75);
    u.onend = () => audioEngine.setPlaying(false);
    u.onerror = () => audioEngine.setPlaying(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const s = latest.current.settings;
      if (!text || latest.current.muted || (s && !s.speakReplies)) return;
      audioEngine.stop();
      if (canProviderTts() && base) {
        try {
          const sessionId = await ensureSession();
          const out = await api<{ provider: string; audio: string | null; format: "mp3" | "pcm16" | null; sampleRate: number | null }>(`${base}/voiceos/speak`, { body: { sessionId, text, language: lang() } });
          if (out.audio && out.format) {
            await audioEngine.play(out.audio, out.format, out.sampleRate, () => undefined);
            return;
          }
        } catch (e) {
          r.current.ttsFailed = true;
          setNotice({ key: e instanceof ApiError && typeof e.details?.reason === "string" && e.details.reason.startsWith("plan_") ? "ttsLimit" : "ttsFallback", tone: "warning" });
        }
      }
      speakBrowser(text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, ensureSession, speakBrowser],
  );

  const stopSpeaking = useCallback(() => audioEngine.stop(), []);

  // ───── Replies ─────
  const reasonText = useCallback((reason: string | null | undefined) => {
    const tt = latest.current.t;
    if (reason && /^[a-z_]+$/.test(reason)) {
      const v = tt(`errors.reasons.${reason}`);
      if (v !== `errors.reasons.${reason}`) return v;
    }
    return tt("jarvis.reply.reasonUnknown");
  }, []);

  const replyText = useCallback(
    (key: string, params: Record<string, string | number>) => {
      const tt = latest.current.t;
      if (key === "delegated") {
        const names = String(params.profiles ?? "")
          .split(",")
          .filter(Boolean)
          .map((p) => {
            const n = tt(`profiles.${p}.name`);
            return n === `profiles.${p}.name` ? p : n;
          });
        let team = names.join(", ");
        try {
          team = new Intl.ListFormat(lang(), { style: "long", type: "conjunction" }).format(names);
        } catch {
          /* older browsers: comma list */
        }
        return tt("jarvis.reply.delegated", { team, count: names.length });
      }
      if (key === "blocked") return tt("jarvis.reply.blocked", { reason: reasonText(String(params.reason ?? "")) });
      if (key === "planned") return tt("jarvis.reply.planned");
      return tt("jarvis.reply.failed");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reasonText],
  );

  // ───── Following the run ─────
  const pollRef = useRef<() => Promise<void>>(async () => undefined);
  const poll = useCallback(async () => {
    const id = r.current.runId;
    const sessionId = r.current.sessionId;
    if (!id || !sessionId || !base) return;
    if (r.current.pollTimer) clearTimeout(r.current.pollTimer);
    r.current.pollTimer = null;
    let next: Omit<FollowedRun, "profiles" | "steps">;
    try {
      next = await api<Omit<FollowedRun, "profiles" | "steps">>(`${base}/voiceos/sessions/${sessionId}/runs/${id}`);
    } catch {
      r.current.pollTimer = setTimeout(() => void pollRef.current(), POLL_MS * 2);
      return;
    }
    if (r.current.runId !== id) return;
    setRun((prev) => (prev && prev.id === id ? { ...prev, ...next } : { ...next, profiles: [], steps: [] }));
    const tt = latest.current.t;
    const fresh = next.approvals.find((a) => !r.current.announced.has(`a:${a.id}`));
    if (fresh) {
      r.current.announced.add(`a:${fresh.id}`);
      setPendingApproval(fresh);
      flashAlert();
      const line = next.canDecide ? tt("jarvis.reply.approvalNeeded", { summary: fresh.summary }) : tt("jarvis.reply.approvalNoPermission", { summary: fresh.summary });
      addTurn({ role: "assistant", text: line, tone: "warning" });
      void speak(line);
    }
    if (!next.approvals.length) setPendingApproval(null);
    if (next.status === "COMPLETED" && next.answer && !r.current.announced.has(`done:${id}`)) {
      r.current.announced.add(`done:${id}`);
      flashSuccess();
      addTurn({ role: "assistant", text: next.answer, tone: "success" });
      void speak(next.spoken ?? next.answer);
    } else if (next.status === "COMPLETED" && !next.answer && !r.current.announced.has(`done:${id}`)) {
      r.current.announced.add(`done:${id}`);
      flashSuccess();
      const line = tt("jarvis.reply.doneNoAnswer");
      addTurn({ role: "assistant", text: line, tone: "success" });
      void speak(line);
    } else if ((next.status === "FAILED" || next.status === "CANCELLED") && !r.current.announced.has(`done:${id}`)) {
      r.current.announced.add(`done:${id}`);
      flashAlert();
      const line = next.status === "FAILED" ? tt("jarvis.reply.runFailed", { reason: reasonText(next.failedReason) }) : tt("jarvis.reply.runCancelled");
      addTurn({ role: "assistant", text: line, tone: "danger" });
      void speak(line);
    }
    if (next.open || next.approvals.length) r.current.pollTimer = setTimeout(() => void pollRef.current(), POLL_MS);
  }, [base, addTurn, speak, flashAlert, flashSuccess, reasonText]);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(
    () => () => {
      if (r.current.pollTimer) clearTimeout(r.current.pollTimer);
    },
    [],
  );

  // ───── Utterances ─────
  const dispatch = useCallback(
    async (rawText: string, mode: TalkMode | "text", provider: string) => {
      const text = rawText.trim();
      if (!text || !base) {
        setPhase("idle");
        return;
      }
      const tt = latest.current.t;
      const said = norm(text);
      if (STOP_WORDS[lang()].includes(said) || STOP_WORDS["en-US"].includes(said)) {
        audioEngine.stop();
        setPhase("idle");
        return;
      }
      addTurn({ role: "user", text, provider });
      setError(null);
      setNotice(null);
      const approval = latest.current.pendingApproval;
      try {
        setPhase("thinking");
        const sessionId = await ensureSession();
        if (approval && mode !== "text") {
          const out = await api<{ outcome: "approve" | "reject" | "unclear"; status?: string }>(`${base}/voiceos/sessions/${sessionId}/confirm`, { body: { approvalId: approval.id, via: "voice", text } });
          setPhase("idle");
          const line = out.outcome === "unclear" ? tt("jarvis.reply.confirmUnclear") : out.outcome === "approve" ? tt("jarvis.reply.approved") : tt("jarvis.reply.rejected");
          addTurn({ role: "assistant", text: line, tone: out.outcome === "unclear" ? "warning" : "success" });
          if (out.outcome !== "unclear") {
            setPendingApproval(null);
            if (out.outcome === "approve") flashSuccess();
            void poll();
          }
          void speak(line);
          return;
        }
        const out = await api<UtterResult>(`${base}/voiceos/sessions/${sessionId}/utterances`, { body: { text, inputMode: mode === "text" ? "text" : mode === "wake" ? "wake" : "voice", provider, path: latest.current.path } });
        setPhase("idle");
        const line = replyText(out.reply.key, out.reply.params);
        addTurn({ role: "assistant", text: line, tone: out.reply.key === "delegated" ? "info" : "warning" });
        if (out.reply.key !== "delegated") flashAlert();
        void speak(line);
        if (out.run) {
          r.current.runId = out.run.id;
          setRun({ id: out.run.id, status: out.run.status, open: out.open, running: 0, answer: null, spoken: null, nextAction: null, failedReason: null, canDecide: false, approvals: [], profiles: out.run.profiles, steps: out.run.steps });
          if (r.current.pollTimer) clearTimeout(r.current.pollTimer);
          r.current.pollTimer = setTimeout(() => void poll(), POLL_MS);
        }
      } catch (e) {
        setPhase("idle");
        setError(e);
        flashAlert();
        if (e instanceof ApiError && e.code === "conflict" && e.details?.reason === "voiceos_session_ended") r.current.sessionId = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, addTurn, ensureSession, poll, replyText, speak, flashAlert, flashSuccess, setPhase],
  );

  // ───── Capture ─────
  const canProviderStt = () => {
    const { boot: b, settings: s } = latest.current;
    if (!b || !s || s.sttProvider === "browser" || r.current.sttFailed || !b.minutes.allowed || typeof MediaRecorder === "undefined") return false;
    return s.sttProvider === "auto" ? b.providers.stt.length > 0 : (b.providers.stt as string[]).includes(s.sttProvider);
  };

  const transcribeSegment = useCallback(
    (blob: Blob, durationMs: number, index: number): Promise<string> =>
      (async () => {
        const sessionId = await ensureSession();
        const out = await api<{ provider: string; text: string | null }>(`${base}/voiceos/transcribe`, {
          body: { sessionId, audio: await blobToBase64(blob), mimeType: blob.type || "audio/webm", durationMs: Math.max(100, Math.min(120_000, Math.round(durationMs))), language: lang() },
        });
        if (out.provider === "browser") r.current.sttFailed = true;
        const text = out.text ?? "";
        r.current.segTexts[index] = text;
        setInterim(r.current.segTexts.filter((x): x is string => !!x).join(" "));
        return text;
      })().catch((e: unknown) => {
        r.current.sttFailed = true;
        setNotice({ key: e instanceof ApiError && typeof e.details?.reason === "string" && e.details.reason.startsWith("plan_") ? "sttLimit" : "sttFallback", tone: "warning" });
        r.current.segTexts[index] = "";
        return "";
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, ensureSession],
  );

  const startRecorder = useCallback(
    (stream: MediaStream) => {
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      const started = performance.now();
      r.current.segStart = started;
      r.current.segSpeech = false;
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const speech = (rec as MediaRecorder & { _speech?: boolean })._speech;
        const dur = performance.now() - started;
        if (!speech || dur < 300 || !chunks.length) return;
        const index = r.current.segments.length;
        r.current.segTexts[index] = null;
        r.current.segments.push(transcribeSegment(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), dur, index));
      };
      rec.start();
      r.current.recorder = rec;
    },
    [transcribeSegment],
  );

  const cutSegment = useCallback(
    (restart: boolean, stream: MediaStream | null): Promise<void> => {
      const rec = r.current.recorder;
      let stopped: Promise<void> = Promise.resolve();
      if (rec && rec.state !== "inactive") {
        (rec as MediaRecorder & { _speech?: boolean })._speech = r.current.segSpeech;
        // Resolves after onstop has registered the phrase for transcription.
        stopped = new Promise<void>((res) => {
          const register = rec.onstop;
          rec.onstop = (ev) => {
            register?.call(rec, ev);
            res();
          };
          setTimeout(res, 2_000);
        });
        rec.stop();
      }
      r.current.recorder = null;
      if (restart && stream) startRecorder(stream);
      return stopped;
    },
    [startRecorder],
  );

  const pauseWake = () => {
    r.current.wakeWanted = false;
    try {
      r.current.wake?.abort();
    } catch {
      /* not running */
    }
    r.current.wake = null;
    setWakeListening(false);
  };

  const finishCapture = useCallback(
    async (cancel = false) => {
      const st = r.current;
      if (!st.capturing) return;
      st.capturing = false;
      if (st.vad) clearInterval(st.vad);
      st.vad = null;
      const mode = st.mode;
      st.mode = null;
      if (st.browserRec) {
        const done = st.browserEnded
          ? Promise.resolve()
          : new Promise<void>((res) => {
              st.browserDone = res;
              setTimeout(res, 1_500);
            });
        try {
          st.browserRec.stop();
        } catch {
          /* already stopped */
        }
        await done;
        st.browserRec = null;
        audioEngine.closeMic();
        const text = st.browserText.trim();
        st.browserText = "";
        setInterim("");
        if (cancel || !text) {
          if (!cancel) setNotice({ key: "notHeard", tone: "info" });
          setPhase("idle");
          return;
        }
        await dispatch(text, mode ?? "ptt", "browser");
        return;
      }
      const lastPhrase = cutSegment(false, null);
      audioEngine.closeMic();
      if (cancel) {
        st.segments = [];
        st.segTexts = [];
        setInterim("");
        setPhase("idle");
        return;
      }
      setPhase("transcribing");
      await lastPhrase;
      const texts = await Promise.all(st.segments);
      st.segments = [];
      st.segTexts = [];
      setInterim("");
      const text = texts.filter(Boolean).join(" ").trim();
      if (!text) {
        // A provider failure already explains itself (and the next capture uses the browser recogniser).
        if (!st.sttFailed) setNotice({ key: "notHeard", tone: "info" });
        setPhase("idle");
        return;
      }
      const b = latest.current.boot;
      const s = latest.current.settings;
      const provider = s?.sttProvider && s.sttProvider !== "auto" ? s.sttProvider : (b?.providers.stt[0] ?? "provider");
      await dispatch(text, mode ?? "ptt", provider);
    },
    [cutSegment, dispatch, setPhase],
  );

  const beginCapture = useCallback(
    async (mode: TalkMode) => {
      const st = r.current;
      if (!base || st.capturing || st.phase === "transcribing" || st.phase === "thinking") return;
      audioEngine.stop(); // barge-in: talking interrupts the reply
      setNotice(null);
      setError(null);
      pauseWake();
      st.capturing = true;
      st.mode = mode;
      let stream: MediaStream;
      try {
        stream = await audioEngine.openMic();
      } catch (e) {
        st.capturing = false;
        st.mode = null;
        setNotice({ key: e instanceof Error && e.message === "mic_unsupported" ? "micUnsupported" : "micDenied", tone: "danger" });
        return;
      }
      if (!st.capturing) {
        audioEngine.closeMic();
        return;
      }
      setPhase("listening");
      st.captureStart = performance.now();
      st.lastVoice = st.captureStart;
      st.hadSpeech = false;
      st.segments = [];
      st.segTexts = [];
      setInterim("");
      const provider = canProviderStt();
      if (provider) startRecorder(stream);
      else {
        const Ctor = recognitionCtor();
        if (!Ctor) {
          st.capturing = false;
          audioEngine.closeMic();
          setPhase("idle");
          setNotice({ key: "noRecognizer", tone: "warning" });
          return;
        }
        const rec = new Ctor();
        rec.lang = lang();
        rec.continuous = true;
        rec.interimResults = true;
        st.browserText = "";
        rec.onresult = (e) => {
          const { finalText, interim: live } = readResults(e);
          if (finalText) st.browserText = `${st.browserText} ${finalText}`.trim();
          setInterim(`${st.browserText} ${live}`.trim());
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") setNotice({ key: "micDenied", tone: "danger" });
        };
        st.browserEnded = false;
        rec.onend = () => {
          st.browserEnded = true;
          st.browserDone?.();
          st.browserDone = null;
          if (st.capturing && st.browserRec === rec) void finishCapture();
        };
        st.browserRec = rec;
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
      st.vad = setInterval(() => {
        if (!st.capturing) return;
        const now = performance.now();
        const lvl = audioEngine.micLevel();
        if (lvl > VAD_THRESHOLD) {
          st.lastVoice = now;
          st.hadSpeech = true;
          st.segSpeech = true;
        }
        const silent = now - st.lastVoice;
        if (provider && st.segSpeech && silent > SEGMENT_SILENCE_MS && now - st.segStart > 700) void cutSegment(true, stream);
        if (st.mode === "wake" || st.mode === "toggle") {
          if (st.hadSpeech && silent > HANDSFREE_SILENCE_MS) void finishCapture();
          else if (!st.hadSpeech && now - st.captureStart > HANDSFREE_NO_SPEECH_MS) void finishCapture(true);
        }
        if (now - st.captureStart > MAX_CAPTURE_MS) void finishCapture();
      }, 60);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, startRecorder, cutSegment, finishCapture, setPhase],
  );

  const startTalk = useCallback((mode: TalkMode = "ptt") => void beginCapture(mode), [beginCapture]);
  const stopTalk = useCallback(() => void finishCapture(false), [finishCapture]);
  const cancelTalk = useCallback(() => void finishCapture(true), [finishCapture]);
  const sendText = useCallback((text: string) => void dispatch(text, "text", "keyboard"), [dispatch]);

  const stopAll = useCallback(() => {
    audioEngine.stop();
    void finishCapture(true);
  }, [finishCapture]);

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      const a = latest.current.pendingApproval;
      const sessionId = r.current.sessionId;
      if (!a || !sessionId || !base) return;
      try {
        await api(`${base}/voiceos/sessions/${sessionId}/confirm`, { body: { approvalId: a.id, via: "click", decision } });
        setPendingApproval(null);
        const line = decision === "approve" ? latest.current.t("jarvis.reply.approved") : latest.current.t("jarvis.reply.rejected");
        addTurn({ role: "assistant", text: line, tone: "success" });
        if (decision === "approve") flashSuccess();
        void poll();
      } catch (e) {
        setError(e);
        flashAlert();
      }
    },
    [base, addTurn, poll, flashAlert, flashSuccess],
  );

  // ───── Push-to-talk keyboard (hold Space), Escape stops ─────
  useEffect(() => {
    if (!spaceToTalk || !enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopAll();
        return;
      }
      if (e.code !== "Space" || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isEditable(e.target)) return;
      e.preventDefault();
      startTalk("ptt");
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isEditable(e.target)) return;
      e.preventDefault();
      if (r.current.mode === "ptt") stopTalk();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [spaceToTalk, enabled, startTalk, stopTalk, stopAll]);

  // ───── Wake word ("Hey Realy"): only when enabled, tab visible, browser supports continuous recognition ─────
  const wakeEnabled = !!settings?.wakeWordEnabled && enabled && !!base && visible;
  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!wakeEnabled || !Ctor || phase !== "idle") return;
    const st = r.current;
    st.wakeWanted = true;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    const phrases = [...WAKE_PHRASES[lang()], ...WAKE_PHRASES["en-US"]].map(norm);
    const stops = [...STOP_WORDS[lang()], ...STOP_WORDS["en-US"]];
    const startRec = () => {
      if (!st.wakeWanted) return;
      const rec = new Ctor();
      rec.lang = lang();
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        const { finalText, interim: live } = readResults(e);
        const heard = norm(`${finalText} ${live}`);
        if (!heard) return;
        if (audioEngine.playing && (stops.some((w) => heard.includes(w)) || phrases.some((p) => heard.includes(p)))) audioEngine.stop();
        const hit = phrases.find((p) => heard.includes(p));
        if (!hit) return;
        const rest = heard.slice(heard.indexOf(hit) + hit.length).trim();
        if (finalText && rest.split(" ").length >= 2) {
          pauseWake();
          void dispatch(rest, "wake", "browser");
        } else if (!finalText || !rest) {
          pauseWake();
          void beginCapture("wake");
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          st.wakeWanted = false;
          setNotice({ key: "micDenied", tone: "danger" });
        } else st.wakeErrors++;
      };
      rec.onend = () => {
        if (st.wake === rec) st.wake = null;
        setWakeListening(false);
        if (st.wakeWanted && st.wakeErrors < 8) restartTimer = setTimeout(startRec, 400);
      };
      try {
        rec.start();
        st.wake = rec;
        setWakeListening(true);
      } catch {
        st.wakeErrors++;
      }
    };
    startRec();
    return () => {
      if (restartTimer) clearTimeout(restartTimer);
      pauseWake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeEnabled, phase, dispatch, beginCapture]);

  // Release everything when the console unmounts.
  useEffect(
    () => () => {
      audioEngine.stop();
      audioEngine.closeMic();
    },
    [],
  );

  return {
    boot,
    bootError,
    settings,
    updateSettings,
    refresh,
    phase,
    speaking,
    micLive: micOpen || wakeListening,
    wakeListening,
    interim,
    turns,
    run,
    pendingApproval,
    notice,
    error,
    muted,
    setMuted: (v: boolean) => {
      setMuted(v);
      if (v) audioEngine.stop();
    },
    flash,
    flashAlert,
    flashSuccess,
    startTalk,
    stopTalk,
    cancelTalk,
    sendText,
    stopSpeaking,
    stopAll,
    decide,
    poke: poll,
    recognitionAvailable,
    providerStt: !!boot && !!settings && settings.sttProvider !== "browser" && boot.providers.stt.length > 0,
    providerTts: !!boot && !!settings && settings.ttsProvider !== "browser" && boot.providers.tts.length > 0,
  };
}
export type VoiceOS = ReturnType<typeof useVoiceOS>;
