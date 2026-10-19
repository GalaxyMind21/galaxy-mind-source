"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { interpolate, type Locale } from "@/lib/i18n";
import { MESSAGES } from "@/lib/messages";

type Ctx = {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<Ctx>({
  locale: "en",
  t: (key, vars) => interpolate(MESSAGES.en[key] ?? key, vars),
});

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<Ctx>(() => {
    const table = MESSAGES[locale] ?? MESSAGES.en;
    return {
      locale,
      t: (key, vars) =>
        interpolate(table[key] ?? MESSAGES.en[key] ?? key, vars),
    };
  }, [locale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useT(): Ctx {
  return useContext(LocaleContext);
}
