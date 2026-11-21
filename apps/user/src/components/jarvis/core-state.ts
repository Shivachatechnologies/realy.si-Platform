import type { Department } from "@/server/modules/voiceos/catalog";

/** The Realy AI Core's states. Each is entered only from a real signal (mic, audio output, request, run, event). */
export type CoreState = "IDLE" | "LISTENING" | "THINKING" | "EXECUTING" | "SPEAKING" | "ALERT" | "SUCCESS";

export interface CoreSignals {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
  /** Open command runs of this conversation, or running AI tasks in the company. */
  executing: boolean;
  /** Until when an ALERT / SUCCESS flash (from a real event or result) is shown. */
  alertUntil: number;
  successUntil: number;
}

export function deriveCoreState(s: CoreSignals, now = Date.now()): CoreState {
  if (s.speaking) return "SPEAKING";
  if (s.listening) return "LISTENING";
  if (s.thinking) return "THINKING";
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
  THINKING: { spin: 1.4, spread: 0.82, glow: 1, tone: "accent" },
  EXECUTING: { spin: 0.7, spread: 1.05, glow: 0.85, tone: "accent" },
  SPEAKING: { spin: 0.45, spread: 1.15, glow: 1.1, tone: "accent" },
  ALERT: { spin: 0.9, spread: 1.1, glow: 1.2, tone: "warning" },
  SUCCESS: { spin: 0.5, spread: 1.2, glow: 1.2, tone: "success" },
};
