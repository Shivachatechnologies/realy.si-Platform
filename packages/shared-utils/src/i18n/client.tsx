"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppLocale } from "./config";
import { createTranslatorCore, mergeMessages, namespaceOf, type MessageTree, type Translate } from "./translate-core";

interface I18nValue {
  locale: AppLocale;
  timeZone: string;
  t: Translate;
  /** Every message delivered to this subtree (this provider's plus its ancestors'). */
  messages: MessageTree;
  /** Subtrees that are never inlined into the HTML and are loaded after hydration (root provider's `lazy`). */
  lazy: readonly string[];
  /** Ask the root provider to fetch a whole namespace (once). `quiet`: an expected load, not a manifest miss. */
  requestNamespace: (ns: string, quiet?: boolean) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

const underLazy = (key: string, lazy: readonly string[]) => lazy.some((p) => key.startsWith(`${p}.`));

/**
 * Client message delivery. The browser never receives the whole catalog: the root layout provides the messages
 * its own client components use, and nested providers (`ClientMessages` boundaries in route-group and module
 * layouts) add the messages of their subtree, deep-merged over their parent's. Which message units each boundary
 * needs is computed statically by scripts/i18n-namespaces.mjs (`pnpm i18n:sync` writes it, `pnpm i18n:check`
 * verifies it) and served by `getClientMessages` in apps/<app>/src/i18n/server.ts.
 *
 * Lazy subtrees (`lazy`, e.g. "errors.reasons"): only their literally used keys are inlined; components that may
 * show the others call usePrefetchMessages() so the namespace loads in the background after hydration.
 *
 * Safety net: if a client component still asks for a key that was not delivered, the root provider fetches its
 * namespace from /api/i18n/<locale>/<ns> once and re-renders (with a console warning, because the manifest missed
 * it). The first paint shows the key; nothing crashes.
 */
export function I18nProvider({
  locale,
  messages,
  timeZone,
  lazy,
  children,
}: {
  /** Required on the root provider; nested providers inherit it. */
  locale?: AppLocale;
  messages: MessageTree;
  timeZone?: string;
  /** Root provider only. */
  lazy?: readonly string[];
  children: ReactNode;
}) {
  const parent = useContext(I18nContext);
  const [extra, setExtra] = useState<MessageTree>({});
  const [requested] = useState(() => new Set<string>());

  const value = useMemo<I18nValue>(() => {
    // Nested boundaries can deliver different parts of one namespace, hence a deep merge.
    const merged = mergeMessages(parent ? parent.messages : extra, messages) as MessageTree;
    const l = locale ?? parent?.locale ?? "en-US";
    const lazyUnits = parent?.lazy ?? lazy ?? [];
    const requestNamespace =
      parent?.requestNamespace ??
      ((ns: string, quiet = false) => {
        if (typeof window === "undefined" || requested.has(ns) || !/^[A-Za-z][\w-]*$/.test(ns)) return;
        requested.add(ns);
        // Deferred out of the render that noticed the miss; state is only set when the response arrives.
        queueMicrotask(() => {
          if (!quiet) console.warn(`[i18n] a "${ns}.…" message was not delivered to this page; loading the namespace on demand (pnpm i18n:sync).`);
          fetch(`/api/i18n/${l}/${encodeURIComponent(ns)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((v: unknown) => {
              if (v && typeof v === "object") setExtra((prev) => ({ ...prev, [ns]: v }));
            })
            .catch(() => {});
        });
      });
    const onMissing = (key: string) => {
      const ns = namespaceOf(key);
      if (underLazy(key, lazyUnits)) return requestNamespace(ns, true);
      // Units are delivered whole ("ns.sub" subtrees), so a key whose subtree is here is simply not in the catalog
      // (some components probe optional keys). Otherwise the manifest may have missed it: load the namespace once.
      const node = merged[ns] as Record<string, unknown> | undefined;
      const sub = key.slice(ns.length + 1).split(".")[0]!;
      if (node && typeof node === "object" && sub in node && typeof node[sub] === "object") return;
      requestNamespace(ns);
    };
    return {
      locale: l,
      timeZone: timeZone ?? parent?.timeZone ?? "UTC",
      t: createTranslatorCore(l, merged, undefined, onMissing),
      messages: merged,
      lazy: lazyUnits,
      requestNamespace,
    };
  }, [parent, messages, extra, locale, timeZone, lazy, requested]);

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}

export const useT = () => useI18n().t;

/**
 * Load a lazy message subtree (e.g. "errors.reasons") in the background once the page is idle, for components that
 * may need any of its keys later (error messages built in event handlers). No-op when it is not lazy here.
 */
export function usePrefetchMessages(prefix: string) {
  const { lazy, requestNamespace } = useI18n();
  const wanted = lazy.includes(prefix);
  useEffect(() => {
    if (!wanted) return;
    const load = () => requestNamespace(namespaceOf(prefix), true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(load, 1500);
    return () => window.clearTimeout(id);
  }, [wanted, prefix, requestNamespace]);
}
