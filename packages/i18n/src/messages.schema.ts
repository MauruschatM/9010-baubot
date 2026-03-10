import { z } from "zod";

export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

export type TranslationLeafPaths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends TranslationTree
          ? `${K}.${TranslationLeafPaths<T[K]>}`
          : never;
    }[keyof T & string];

export const translationTreeSchema: z.ZodType<TranslationTree> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), translationTreeSchema])),
);

export function createTranslationSchema<T extends TranslationTree>(
  example: T,
): z.ZodType<T> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(example)) {
    shape[key] =
      typeof value === "string"
        ? z.string()
        : createTranslationSchema(value as TranslationTree);
  }

  return z.object(shape) as unknown as z.ZodType<T>;
}
