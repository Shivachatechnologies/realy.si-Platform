import type { Department } from "@/server/modules/voiceos/catalog";

/** The Realy AI Core's states. Each is entered only from a real signal (mic, audio output, request, run, event). */
export type CoreState = "IDLE" | "LISTENING" | "TRANSCRIBING" | "THINKING" | "EXECUTING" | "SPEAKING" | "SUCCESS" | "ERROR" | "ALERT";

/** Every state, in lifecycle order (labels, legends, tests). */
export const CORE_STATES: readonly CoreState[] = ["IDLE", "LISTENING", "TRANSCRIBING", "THINKING", "EXECUTING", "SPEAKING", "SUCCESS", "ERROR", "ALERT"];

export interface CoreSignals {
  listening: boolean;
  /** Recorded speech is being turned into text (provider STT request in flight, or the recogniser finishing). */
  transcribing?: boolean;
  thinking: boolean;
  speaking: boolean;
  /** Open command runs of this conversation, or running AI tasks in the company. */
  executing: boolean;
  /** Until when an ALERT / SUCCESS flash (from a real event or result) is shown. */
  alertUntil: number;
  successUntil: number;
  /** Until when an ERROR (a request, provider or microphone failure the person was told about) is shown. */
  errorUntil?: number;
}

/**
 * The lifecycle: IDLE → LISTENING (mic) → TRANSCRIBING (speech → text) → THINKING (routing / answering) →
 * EXECUTING (AI Command run in flight) → SPEAKING (voice output) → SUCCESS, or ERROR on a failure; ALERT for a real
 * event that needs attention (approval, failed task). Live activity outranks flashes; a failure outranks an alert.
 */
export function deriveCoreState(s: CoreSignals, now = Date.now()): CoreState {
  if (s.speaking) return "SPEAKING";
  if (s.listening) return "LISTENING";
  if (s.transcribing) return "TRANSCRIBING";
  if (s.thinking) return "THINKING";
  if ((s.errorUntil ?? 0) > now) return "ERROR";
  if (s.alertUntil > now) return "ALERT";
  if (s.successUntil > now) return "SUCCESS";
  if (s.executing) return "EXECUTING";
  return "IDLE";
}

export interface CoreVisualProps {
  state: CoreState;
  /** Real audio level 0–1 (read every frame; mic while listening, voice output while speaking). */
  level: () => number;
  /** Last activity time (ms) per department, from the live event stream. */
  pulses: Partial<Record<Department, number>>;
  /** 0–1: real AI workload (running tasks normalised). */
  activity: number;
  paused?: boolean;
}

/** Visual tuning per state: rotation speed, particle spread, ring tilt amplitude, core glow. */
export const STATE_TUNING: Record<CoreState, { spin: number; spread: number; glow: number; tone: "accent" | "danger" | "success" | "warning" }> = {
  IDLE: { spin: 0.15, spread: 1, glow: 0.55, tone: "accent" },
  LISTENING: { spin: 0.35, spread: 1.12, glow: 0.9, tone: "accent" },
  TRANSCRIBING: { spin: 0.95, spread: 0.92, glow: 0.95, tone: "accent" },
  THINKING: { spin: 1.4, spread: 0.82, glow: 1, tone: "accent" },
  EXECUTING: { spin: 0.7, spread: 1.05, glow: 0.85, tone: "accent" },
  SPEAKING: { spin: 0.45, spread: 1.15, glow: 1.1, tone: "accent" },
  ALERT: { spin: 0.9, spread: 1.1, glow: 1.2, tone: "warning" },
  SUCCESS: { spin: 0.5, spread: 1.2, glow: 1.2, tone: "success" },
  ERROR: { spin: 0.08, spread: 0.9, glow: 0.8, tone: "danger" },
};
