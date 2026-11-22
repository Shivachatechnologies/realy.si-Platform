/**
 * Support ticket enums shared by server pages and client forms. Kept out of the "use client" form module so server
 * components get the real arrays instead of client references (which cannot be iterated on the server).
 */
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const STATUSES = ["NEW", "OPEN", "PENDING", "ON_HOLD", "SOLVED", "CLOSED"] as const;
export const CHANNELS = ["WEB", "EMAIL", "CHAT", "PHONE", "WHATSAPP"] as const;
