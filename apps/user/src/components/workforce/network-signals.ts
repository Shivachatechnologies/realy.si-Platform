/** Live signal pulses shared by the 3D scene and the 2D fallback (no three.js import here). */
export type SignalKind = "task" | "done" | "failed" | "delegation" | "approval" | "call" | "escalation" | "rollup";

export interface Pulse {
  from: number;
  to: number;
  start: number;
  kind: SignalKind;
}

export const SIGNAL_KINDS: SignalKind[] = ["task", "done", "failed", "delegation", "approval", "call", "escalation", "rollup"];

export const PULSE_COLOR: Record<SignalKind, string> = {
  task: "#7c9cff",
  done: "#34d399",
  failed: "#f87171",
  delegation: "#c084fc",
  approval: "#fbbf24",
  call: "#22d3ee",
  escalation: "#fb923c",
  rollup: "#a3e635",
};
