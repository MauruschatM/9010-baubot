import {
  DEFAULT_LOCALE,
  getLocaleDirection,
  LOCALE_COOKIE_NAME,
  SYSTEM_LOCALE,
  createTranslator,
  getMessagesForLocale,
  normalizeTranslatedLocale,
  type AppLocale,
  type LocalePreference,
  type Messages,
  type Translator,
} from "@mvp-template/i18n";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type I18nContextValue = {
  locale: AppLocale;
  messages: Messages;
  t: Translator;
  setLocale: (nextLocale: AppLocale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function writeLocaleCookie(locale: LocalePreference) {
  if (typeof document === "undefined") {
    return;
  }

  const cookieValue = locale === SYSTEM_LOCALE ? SYSTEM_LOCALE : locale;
  const securePart = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${securePart}`;
}

export function I18nProvider({
  initialLocale,
  children,
}: PropsWithChildren<{
  initialLocale: AppLocale;
}>) {
  const [locale, setLocaleState] = useState<AppLocale>(
    normalizeTranslatedLocale(initialLocale) ?? DEFAULT_LOCALE,
  );

  useEffect(() => {
    const normalizedInitial = normalizeTranslatedLocale(initialLocale) ?? DEFAULT_LOCALE;
    setLocaleState((current) => (current === normalizedInitial ? current : normalizedInitial));
  }, [initialLocale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.dir = getLocaleDirection(locale);
    }
  }, [locale]);

  const messages = useMemo(() => getMessagesForLocale(locale), [locale]);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      messages,
      t,
      setLocale: (nextLocale) => {
        const normalized = normalizeTranslatedLocale(nextLocale) ?? DEFAULT_LOCALE;
        setLocaleState(normalized);
        writeLocaleCookie(normalized);
      },
    }),
    [locale, messages, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
