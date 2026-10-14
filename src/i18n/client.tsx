"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppLocale } from "./config";
import { createTranslator, type Messages, type Translate } from "./translate";

interface I18nValue {
  locale: AppLocale;
  timeZone: string;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  timeZone,
  children,
}: {
  locale: AppLocale;
  messages: Messages;
  timeZone?: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, timeZone: timeZone ?? "UTC", t: createTranslator(locale, messages) }),
    [locale, messages, timeZone],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}

export const useT = () => useI18n().t;
