import type { SupportPriority } from "@/generated/prisma/enums";

/**
 * Rule-based ticket classifier (runs instantly on creation): category by keyword hits, priority by urgency words,
 * a coarse sentiment, and tags. An optional AI classification can refine it afterwards.
 */
const URGENT = ["outage", "down for everyone", "data loss", "security breach", "hacked", "production down", "not working at all", "dringend", "紧急", "urgent"];
const HIGH = ["asap", "cannot log in", "can't log in", "cant login", "unable to", "broken", "error", "crash", "charged twice", "refund", "blocked", "fehler", "无法"];
const NEGATIVE = ["angry", "terrible", "awful", "unacceptable", "disappointed", "frustrat", "worst", "cancel my", "complaint", "ridiculous"];
const POSITIVE = ["thank", "great", "love", "awesome", "appreciate", "happy"];

export interface CategoryRule {
  id: string;
  name: string;
  keywords: string[];
  defaultPriority: SupportPriority | null;
}

export interface Classification {
  categoryId: string | null;
  priority: SupportPriority;
  sentiment: "negative" | "neutral" | "positive";
  matched: string[];
  tags: string[];
}

const count = (text: string, words: string[]) => words.filter((w) => text.includes(w));

export function classifyTicket(subject: string, description: string | null | undefined, categories: CategoryRule[]): Classification {
  const text = `${subject}\n${description ?? ""}`.toLowerCase();
  let best: { c: CategoryRule; hits: string[] } | null = null;
  for (const c of categories) {
    const words = [...c.keywords, c.name].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3);
    const hits = count(text, words);
    if (hits.length && (!best || hits.length > best.hits.length)) best = { c, hits };
  }
  const urgent = count(text, URGENT);
  const high = count(text, HIGH);
  const negative = count(text, NEGATIVE);
  const positive = count(text, POSITIVE);
  const priority: SupportPriority = urgent.length ? "URGENT" : high.length ? "HIGH" : (best?.c.defaultPriority ?? "NORMAL");
  const sentiment = negative.length > positive.length ? "negative" : positive.length > negative.length ? "positive" : "neutral";
  const tags = [...(urgent.length ? ["urgent"] : []), ...(sentiment === "negative" ? ["unhappy"] : []), ...(/refund|charged|invoice|billing|payment/.test(text) ? ["billing"] : [])];
  return { categoryId: best?.c.id ?? null, priority, sentiment, matched: [...(best?.hits ?? []), ...urgent, ...high], tags };
}
