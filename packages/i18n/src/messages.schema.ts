import { z } from "zod";

export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

export const translationTreeSchema: z.ZodType<TranslationTree> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), translationTreeSchema])),
);
