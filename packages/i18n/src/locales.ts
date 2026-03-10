export const SUPPORTED_LOCALES = [
  "en",
  "de",
  "pl",
  "ar",
  "ro",
  "tr",
  "bg",
  "hr",
  "sr",
  "bs",
  "uk",
  "ru",
  "it",
  "ar-PS",
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const TRANSLATED_LOCALES = [
  "en",
  "de",
  "pl",
  "ar",
  "ro",
  "tr",
  "bg",
  "hr",
  "sr",
  "bs",
  "uk",
  "ru",
  "it",
  "ar-PS",
] as const satisfies readonly AppLocale[];
export const SYSTEM_LOCALE = "system" as const;
export type LocalePreference = AppLocale | typeof SYSTEM_LOCALE;
export type LocaleDirection = "ltr" | "rtl";

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "locale";

const CANONICAL_LOCALE_MAP = new Map(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale] as const),
);
const TRANSLATED_LOCALE_SET = new Set<string>(TRANSLATED_LOCALES);
const RTL_LOCALE_SET = new Set<AppLocale>(["ar", "ar-PS"]);
const FALLBACK_LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  de: "Deutsch",
  pl: "Polski",
  ar: "العربية",
  ro: "Română",
  tr: "Türkçe",
  bg: "Български",
  hr: "Hrvatski",
  sr: "Srpski",
  bs: "Bosanski",
  uk: "Українська",
  ru: "Русский",
  it: "Italiano",
  "ar-PS": "العربية (فلسطين)",
};

export function isAppLocale(value: string): value is AppLocale {
  return CANONICAL_LOCALE_MAP.get(value.toLowerCase()) === value;
}

export function normalizeLocale(input: string | null | undefined): AppLocale | null {
  if (!input) {
    return null;
  }

  const normalized = input.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) {
    return null;
  }

  const exactMatch = CANONICAL_LOCALE_MAP.get(normalized);
  if (exactMatch) {
    return exactMatch;
  }

  const [language] = normalized.split("-");
  if (!language) {
    return null;
  }

  const languageMatch = CANONICAL_LOCALE_MAP.get(language);
  return languageMatch ?? null;
}

export function normalizeTranslatedLocale(
  input: string | null | undefined,
): AppLocale | null {
  const normalized = normalizeLocale(input);
  if (!normalized) {
    return null;
  }

  return TRANSLATED_LOCALE_SET.has(normalized) ? normalized : null;
}

export function resolveTranslatedLocale(
  input: string | null | undefined,
  fallback: AppLocale = DEFAULT_LOCALE,
): AppLocale {
  return normalizeTranslatedLocale(input) ?? fallback;
}

export function getLocaleDirection(locale: string | null | undefined): LocaleDirection {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  return RTL_LOCALE_SET.has(normalized) ? "rtl" : "ltr";
}

export function getLocaleDisplayName(
  locale: AppLocale,
  displayLocale: string | null | undefined = DEFAULT_LOCALE,
) {
  const resolvedDisplayLocale = resolveTranslatedLocale(displayLocale);

  if (typeof Intl !== "undefined" && "DisplayNames" in Intl) {
    try {
      const displayNames = new Intl.DisplayNames([resolvedDisplayLocale], {
        type: "language",
      });
      const translatedLabel = displayNames.of(locale);
      if (translatedLabel) {
        return translatedLabel;
      }
    } catch {
      // Fall back to the static label map when DisplayNames is unavailable.
    }
  }

  return FALLBACK_LOCALE_LABELS[locale];
}

export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName !== name) {
      continue;
    }

    const value = rawValueParts.join("=");
    return value ? decodeURIComponent(value) : "";
  }

  return null;
}
