import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import { translationTreeSchema, type TranslationTree } from "./messages.schema";
import { PROVIDER_ERROR_CODES } from "./provider-error-codes";

function flattenLeafPaths(
  node: TranslationTree,
  pathPrefix = "",
  target = new Set<string>(),
) {
  for (const [key, value] of Object.entries(node)) {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (typeof value === "string") {
      target.add(nextPath);
      continue;
    }

    flattenLeafPaths(value, nextPath, target);
  }

  return target;
}

function getNodeAtPath(tree: TranslationTree, path: string) {
  const parts = path.split(".");
  let cursor: string | TranslationTree | undefined = tree;

  for (const part of parts) {
    if (!cursor || typeof cursor === "string") {
      return undefined;
    }

    cursor = cursor[part];
  }

  return cursor;
}

function assertLocaleParity(
  validatedCatalog: Record<AppLocale, TranslationTree>,
  baseLocale: AppLocale,
) {
  const baseLeaves = flattenLeafPaths(validatedCatalog[baseLocale]);

  for (const locale of Object.keys(validatedCatalog) as AppLocale[]) {
    const localeLeaves = flattenLeafPaths(validatedCatalog[locale]);

    for (const leaf of baseLeaves) {
      if (!localeLeaves.has(leaf)) {
        throw new Error(`Missing translation key \"${leaf}\" in locale \"${locale}\"`);
      }
    }

    for (const leaf of localeLeaves) {
      if (!baseLeaves.has(leaf)) {
        throw new Error(
          `Unexpected translation key \"${leaf}\" in locale \"${locale}\"`,
        );
      }
    }
  }
}

function assertProviderErrorCoverage(
  validatedCatalog: Record<AppLocale, TranslationTree>,
  requiredCodes: readonly string[],
) {
  for (const locale of Object.keys(validatedCatalog) as AppLocale[]) {
    const providerNode = getNodeAtPath(validatedCatalog[locale], "errors.provider");
    if (!providerNode || typeof providerNode === "string") {
      throw new Error(`Missing errors.provider translation group for locale \"${locale}\"`);
    }

    for (const code of requiredCodes) {
      const value = providerNode[code];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(
          `Missing provider error translation for code \"${code}\" in locale \"${locale}\"`,
        );
      }
    }
  }
}

export function validateMessagesCatalog<TCatalog extends Record<AppLocale, unknown>>(
  catalog: TCatalog,
  options?: {
    baseLocale?: AppLocale;
    requiredProviderCodes?: readonly string[];
  },
): { [K in keyof TCatalog]: TranslationTree } {
  const validated = {} as Record<AppLocale, TranslationTree>;

  for (const locale of Object.keys(catalog) as AppLocale[]) {
    validated[locale] = translationTreeSchema.parse(catalog[locale]);
  }

  const baseLocale = options?.baseLocale ?? DEFAULT_LOCALE;
  assertLocaleParity(validated, baseLocale);
  assertProviderErrorCoverage(
    validated,
    options?.requiredProviderCodes ?? PROVIDER_ERROR_CODES,
  );

  return validated as { [K in keyof TCatalog]: TranslationTree };
}

export function assertProviderTranslationsForCodes(
  catalog: Record<AppLocale, TranslationTree>,
  codes: readonly string[],
) {
  assertProviderErrorCoverage(catalog, codes);
}
