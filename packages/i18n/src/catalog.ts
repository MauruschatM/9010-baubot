import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import { messagesDe } from "./messages.de";
import { messagesEn } from "./messages.en";
import { type TranslationTree } from "./messages.schema";
import { validateMessagesCatalog } from "./validate";

const rawCatalog = {
  en: messagesEn,
  de: messagesDe,
} satisfies Record<AppLocale, unknown>;

export const messagesCatalog = validateMessagesCatalog(rawCatalog, {
  baseLocale: DEFAULT_LOCALE,
});

export type Messages = (typeof messagesCatalog)[AppLocale];

export type TranslationVariables = Record<string, string | number>;

function getByPath(tree: TranslationTree, path: string): string | undefined {
  const parts = path.split(".");
  let cursor: string | TranslationTree | undefined = tree;

  for (const part of parts) {
    if (!cursor || typeof cursor === "string") {
      return undefined;
    }

    cursor = cursor[part];
  }

  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, variables?: TranslationVariables) {
  if (!variables) {
    return template;
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return full;
    }

    return String(value);
  });
}

export function getMessagesForLocale(locale: AppLocale): Messages {
  return messagesCatalog[locale] ?? messagesCatalog[DEFAULT_LOCALE];
}

export function hasMessage(locale: AppLocale, key: string): boolean {
  return getByPath(getMessagesForLocale(locale), key) !== undefined;
}

export function translateForLocale(
  locale: AppLocale,
  key: string,
  variables?: TranslationVariables,
) {
  const localeMessages = getMessagesForLocale(locale);
  const message =
    getByPath(localeMessages, key) ?? getByPath(messagesCatalog[DEFAULT_LOCALE], key);

  if (!message) {
    return key;
  }

  return interpolate(message, variables);
}

export type Translator = (key: string, variables?: TranslationVariables) => string;

export function createTranslator(locale: AppLocale): Translator {
  return (key, variables) => translateForLocale(locale, key, variables);
}
