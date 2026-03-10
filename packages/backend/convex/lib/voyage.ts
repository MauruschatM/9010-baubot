const DEFAULT_VOYAGE_EMBEDDING_MODEL = "voyage-4";

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

export async function embedTextsWithVoyage(
  inputs: string[],
  options?: {
    inputType?: "document" | "query";
    model?: string;
  },
): Promise<number[][] | null> {
  if (inputs.length === 0) {
    return [];
  }

  const voyageApiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!voyageApiKey) {
    return null;
  }

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${voyageApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options?.model ?? DEFAULT_VOYAGE_EMBEDDING_MODEL,
      input: inputs,
      input_type: options?.inputType ?? "document",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Voyage embeddings request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{
      embedding?: unknown;
      index?: unknown;
    }>;
  };
  const data = Array.isArray(payload.data) ? payload.data : [];
  const embeddings: Array<number[] | null> = Array.from({ length: inputs.length }, () => null);

  for (const entry of data) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const index = typeof entry.index === "number" ? entry.index : -1;
    if (index < 0 || index >= inputs.length || !Array.isArray(entry.embedding)) {
      continue;
    }

    const vector = entry.embedding.filter((value): value is number => typeof value === "number");
    if (vector.length > 0) {
      embeddings[index] = vector;
    }
  }

  if (embeddings.some((embedding) => !embedding)) {
    throw new Error("Voyage embeddings response was missing vectors.");
  }

  return embeddings.map((embedding) => embedding as number[]);
}
