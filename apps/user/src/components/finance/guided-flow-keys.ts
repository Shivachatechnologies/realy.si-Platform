/**
 * The six guided finance flows. Shared by the server page (`/finance/start`) and the "use client" flow UI; kept in a
 * plain module so the server gets the real array rather than a client reference.
 */
export const FLOWS = ["income", "expense", "invoice", "payments", "bills", "profit"] as const;
export type Flow = (typeof FLOWS)[number];
