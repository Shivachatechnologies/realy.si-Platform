"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

export type AgentTaskState = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface LiveTask {
  id: string;
  title: string;
  status: AgentTaskState;
  output: string | null;
  errorMessage?: string | null;
}

export const isActive = (s: AgentTaskState | undefined | null) => s === "QUEUED" || s === "RUNNING";

/**
 * Follows a real AI task: polls GET /tasks/:id while it is queued or running and returns its current status and output.
 * `base` is the company API prefix (/api/v1/organizations/:org/companies/:company).
 */
export function useAgentTask(base: string, initial: LiveTask | null, intervalMs = 2500) {
  const [task, setTask] = useState<LiveTask | null>(initial);
  const [pollError, setPollError] = useState(false);
  const id = task?.id;
  const active = isActive(task?.status);

  useEffect(() => {
    if (!id || !active) return;
    let stop = false;
    const handle = setInterval(async () => {
      try {
        const next = await api<LiveTask>(`${base}/tasks/${id}`);
        if (stop) return;
        setPollError(false);
        setTask({ id: next.id, title: next.title, status: next.status, output: next.output, errorMessage: next.errorMessage ?? null });
      } catch {
        if (!stop) setPollError(true);
      }
    }, intervalMs);
    return () => {
      stop = true;
      clearInterval(handle);
    };
  }, [base, id, active, intervalMs]);

  const track = useCallback((t: LiveTask) => setTask(t), []);
  return { task, track, pollError };
}
