import { IntlMessageFormat } from "intl-messageformat";
import enUS from "./messages/en-US.json";

export type Messages = typeof enUS;
export type TranslateValues = Record<string, string | number | Date>;
export type Translate = (key: string, values?: TranslateValues) => string;

/**
 * Resolve a dotted path. Message keys may themselves contain dots (e.g. feature keys like
 * "agents.max"), so at each level the remaining path is also tried as one literal key.
 */
function lookup(messages: unknown, key: string): string | undefined {
  const parts = key.split(".");
  let node: unknown = messages;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Record<string, unknown>;
    const rest = parts.slice(i).join(".");
    if (i < parts.length - 1 && typeof obj[rest] === "string") return obj[rest] as string;
    if (!(parts[i]! in obj)) return undefined;
    node = obj[parts[i]!];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Build a translator for one locale. ICU MessageFormat (plurals, selects, number/date args).
 * Missing keys fall back to en-US, then to the key itself (never crash a page over a string).
 */
export function createTranslator(locale: string, messages: unknown): Translate {
  const cache = new Map<string, IntlMessageFormat>();
  return (key, values) => {
    let fmt = cache.get(key);
    if (!fmt) {
      const own = lookup(messages, key);
      const source = own ?? lookup(enUS, key);
      if (source === undefined) return key;
      fmt = new IntlMessageFormat(source, own !== undefined ? locale : "en-US");
      cache.set(key, fmt);
    }
    return String(fmt.format(values));
  };
}
