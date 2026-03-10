import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SYSTEM_LOCALE,
  resolveLocale,
  resolveTranslatedLocale,
  type AppLocale,
} from "@mvp-template/i18n";
import { api } from "@mvp-template/backend/convex/_generated/api";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";

import { fetchAuthQuery } from "@/lib/auth-server";

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function setLocaleCookie(locale: AppLocale) {
  setCookie(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export const getInitialLocaleForRouting = createServerFn({ method: "GET" }).handler(
  async () => {
    const cookieLocale = getCookie(LOCALE_COOKIE_NAME) ?? null;
    const acceptLanguage = getRequestHeader("accept-language") ?? null;

    let userPreference: AppLocale | null = null;

    try {
      userPreference = await fetchAuthQuery(api.preferences.getMyLocale, {});
    } catch {
      userPreference = null;
    }

    const resolvedLocale = resolveTranslatedLocale(
      resolveLocale({
        userPreference,
        cookieLocale,
        acceptLanguage,
        defaultLocale: DEFAULT_LOCALE,
      }),
    );

    if (cookieLocale !== resolvedLocale && cookieLocale !== SYSTEM_LOCALE) {
      setLocaleCookie(resolvedLocale);
    }

    return resolvedLocale;
  },
);
