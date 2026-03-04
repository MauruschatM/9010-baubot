import {
  assertProviderTranslationsForCodes,
  messagesCatalog,
  type Translator,
} from "@mvp-template/i18n";

let providerCoverageChecked = false;

export function ensureProviderErrorCoverage(codes: readonly string[]) {
  if (providerCoverageChecked) {
    return;
  }

  assertProviderTranslationsForCodes(messagesCatalog, codes);
  providerCoverageChecked = true;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractAuthErrorCode(error: unknown): string | null {
  if (!isObjectLike(error)) {
    return null;
  }

  const directCode = error.code;
  if (typeof directCode === "string" && directCode.length > 0) {
    return directCode;
  }

  const nestedError = error.error;
  if (isObjectLike(nestedError)) {
    const nestedCode = nestedError.code;
    if (typeof nestedCode === "string" && nestedCode.length > 0) {
      return nestedCode;
    }
  }

  return null;
}

export function getLocalizedAuthErrorMessage(
  t: Translator,
  error: unknown,
  fallbackKey = "errors.genericUnexpected",
) {
  const code = extractAuthErrorCode(error);
  if (code) {
    const providerKey = `errors.provider.${code}`;
    const translated = t(providerKey);
    if (translated !== providerKey) {
      return translated;
    }
  }

  return t(fallbackKey);
}
