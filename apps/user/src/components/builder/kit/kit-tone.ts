/**
 * Badge/dot tone per kit item status. Shared by the server kit page and the "use client" item panel; kept in a plain
 * module so the server reads the real map instead of a client reference.
 */
export const KIT_TONE = { PENDING: "neutral", GENERATING: "info", READY: "success", FAILED: "danger", NEEDS_SETUP: "warning" } as const;
