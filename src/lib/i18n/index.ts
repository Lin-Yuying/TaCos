import zh from "./zh";

// UI strings are keyed by their English text: a string missing from a dictionary
// simply renders in English, and call sites stay readable. No DB imports here —
// client components import this module.

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

// Carries the choice to pages rendered before sign-in (login, register).
export const LOCALE_COOKIE = "tacos_locale";

export const LOCALE_LABELS: Record<Locale, string> = { en: "English", zh: "中文" };

const DICTIONARIES: Record<Locale, Record<string, string>> = { en: {}, zh };

export function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : null;
}

// Picks the first supported language from an Accept-Language header.
export function localeFromAcceptLanguage(header: string | null): Locale {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

export type TranslateParams = Record<string, string | number>;
export type Translate = (text: string, params?: TranslateParams) => string;

export function translate(locale: Locale, text: string, params?: TranslateParams): string {
  const template = DICTIONARIES[locale][text] ?? text;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

export function translator(locale: Locale): Translate {
  return (text, params) => translate(locale, text, params);
}
