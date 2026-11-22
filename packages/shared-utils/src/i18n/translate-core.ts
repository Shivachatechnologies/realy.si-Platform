import { IntlMessageFormat } from "intl-messageformat";

/**
 * Catalog-free translator core. Client code imports this module (never `./translate`, which statically imports the
 * full en-US catalog as the server-side fallback and would put ~1 MB of JSON into every client bundle).
 */
export type TranslateValues = Record<string, string | number | Date>;
export type Translate = (key: string, values?: TranslateValues) => string;
/** A (possibly partial) message catalog: top-level namespaces → nested message objects. */
export type MessageTree = Record<string, unknown>;

/**
 * Resolve a dotted path. Message keys may themselves contain dots (e.g. feature keys like
 * "agents.max"), so at each level the remaining path is also tried as one literal key.
 */
export function lookup(messages: unknown, key: string): string | undefined {
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

/** Top-level namespace of a message key ("crm.stages.lead" → "crm"). */
export const namespaceOf = (key: string) => key.split(".", 1)[0]!;

/**
 * Build a translator for one locale. ICU MessageFormat (plurals, selects, number/date args).
 * Missing keys fall back to `fallback` (en-US on the server), then to the key itself (never crash a page over a
 * string); `onMissing` is told about keys found in neither.
 */
export function createTranslatorCore(
  locale: string,
  messages: unknown,
  fallback?: unknown,
  onMissing?: (key: string) => void,
): Translate {
  const cache = new Map<string, IntlMessageFormat>();
  return (key, values) => {
    let fmt = cache.get(key);
    if (!fmt) {
      const own = lookup(messages, key);
      const source = own ?? (fallback === undefined ? undefined : lookup(fallback, key));
      if (source === undefined) {
        onMissing?.(key);
        return key;
      }
      fmt = new IntlMessageFormat(source, own !== undefined ? locale : "en-US");
      cache.set(key, fmt);
    }
    return String(fmt.format(values));
  };
}

/** Deep merge of message trees (`b` wins). Nested client-message boundaries deliver parts of the same namespace. */
export function mergeMessages(a: unknown, b: unknown): unknown {
  if (!a || typeof a !== "object" || !b || typeof b !== "object") return b === undefined ? a : b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = mergeMessages(out[k], v);
  return out;
}
