"use client";

import { createContext, Fragment, useContext, useEffect, useMemo, type ReactNode } from "react";
import { translator, type Locale, type Translate } from "@/lib/i18n";

type I18n = { locale: Locale; t: Translate };

// Without a provider everything renders in English, so a component that has not been
// wired up yet still works.
const I18nContext = createContext<I18n>({ locale: "en", t: translator("en") });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: translator(locale) }), [locale]);
  // The root layout is static and ships lang="en"; the real language is per account.
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

// For a translated sentence with markup inside: t() the whole sentence with `{name}`
// placeholders, then put the elements back in whatever order the translation uses.
export function interpolate(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={index}>{name && name in parts ? parts[name] : piece}</Fragment>;
  });
}
