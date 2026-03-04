import { DEFAULT_LOCALE, type AppLocale, normalizeLocale } from "./locales";

type WeightedLocale = {
  locale: string;
  quality: number;
};

function parseQualityToken(token: string | undefined) {
  if (!token) {
    return 1;
  }

  const [name, rawQuality] = token.split("=");
  if (name?.trim() !== "q" || !rawQuality) {
    return 1;
  }

  const parsed = Number(rawQuality.trim());
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return parsed;
}

export function parseAcceptLanguage(headerValue: string | null | undefined): string[] {
  if (!headerValue) {
    return [];
  }

  const weighted: WeightedLocale[] = headerValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [localeToken, qualityToken] = part.split(";");
      return {
        locale: localeToken?.trim() ?? "",
        quality: parseQualityToken(qualityToken?.trim()),
      } satisfies WeightedLocale;
    })
    .filter((entry) => entry.locale.length > 0)
    .sort((a, b) => b.quality - a.quality);

  return weighted.map((entry) => entry.locale);
}

export function resolveLocale(options: {
  userPreference?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
  defaultLocale?: AppLocale;
}): AppLocale {
  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE;

  const fromUser = normalizeLocale(options.userPreference);
  if (fromUser) {
    return fromUser;
  }

  const fromCookie = normalizeLocale(options.cookieLocale);
  if (fromCookie) {
    return fromCookie;
  }

  const acceptCandidates = parseAcceptLanguage(options.acceptLanguage);
  for (const candidate of acceptCandidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return defaultLocale;
}
