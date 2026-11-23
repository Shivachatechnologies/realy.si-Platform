import type { StatusToneMap } from "./types";

/** Stream F — CMS, support tickets, email, webhooks, files, telephony, API keys. */
export const tonesF: StatusToneMap = {
  cmsEntry: { DRAFT: "warning", SCHEDULED: "info", PUBLISHED: "success", ARCHIVED: "neutral" },
  platformTicket: { NEW: "brand", OPEN: "info", PENDING_CUSTOMER: "warning", ON_HOLD: "neutral", SOLVED: "success", CLOSED: "neutral" },
  ticketPriority: { LOW: "neutral", NORMAL: "info", HIGH: "warning", URGENT: "danger" },
  ticketSla: { met: "success", ok: "neutral", due: "warning", breached: "danger", none: "neutral" },
  emailStatus: { SENT: "info", FAILED: "danger", NOT_CONFIGURED: "neutral" },
  emailEvent: { delivered: "success", bounced: "danger", complained: "danger", deferred: "warning", opened: "info", clicked: "info" },
  webhookDelivery: { PENDING: "warning", SUCCEEDED: "success", FAILED: "danger" },
  apiKey: { active: "success", disabled: "warning", expired: "neutral", revoked: "danger" },
  voiceCall: { AWAITING_APPROVAL: "warning", SCHEDULED: "info", QUEUED: "info", RINGING: "info", IN_PROGRESS: "brand", ENDED: "success", FAILED: "danger", BLOCKED: "warning", CANCELLED: "neutral", REJECTED: "neutral" },
  fileStatus: { stored: "success", archived: "neutral", no_file: "warning" },
  fileDeletion: { PENDING: "warning", APPROVED: "success", REJECTED: "neutral", CANCELLED: "neutral", FAILED: "danger" },
  integrationHealth: { healthy: "success", degraded: "warning", failing: "danger", idle: "neutral", unconfigured: "warning", disabled: "neutral" },
  httpClass: { "2xx": "success", "3xx": "info", "4xx": "warning", "5xx": "danger" },
};
