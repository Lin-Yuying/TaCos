import { cookies, headers } from "next/headers";
import { asLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from "./i18n";

// An account's own choice wins; before sign-in (or while it is unset) the cookie the
// language menu last wrote, and otherwise the browser's preferred language.
export async function resolveLocale(user?: { locale: Locale | null } | null): Promise<Locale> {
  if (user?.locale) return user.locale;
  const fromCookie = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}
