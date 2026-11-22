import type { RequestContext } from "@/server/core/context";

/**
 * Admin notifications (stream A). Step 0 ships the producer API as a NO-OP so streams C–F can call it from day 1;
 * stream A replaces the body with the `platform_notifications` write (deduplicated by `dedupeKey`) without changing
 * the signature.
 */
export interface AdminNotificationInput {
  /** Deliver to every holder of this platform permission (e.g. "platform.incidents.read"). */
  permission?: string;
  /** Or to one admin. */
  userId?: string;
  /** "alert.raised", "support.ticket_created", "job.dead_letter", … */
  type: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body?: string;
  /** Locale-relative console link, e.g. "/alerts/<id>". */
  href?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Step 0 no-op; stream A implements it.
export async function notifyAdmins(_ctx: RequestContext | null, _input: AdminNotificationInput): Promise<void> {}
