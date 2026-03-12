import { ConvexError } from "convex/values";

export const MAX_PROJECT_LOCATION_LENGTH = 120;

type ProjectLocationSource = {
  location?: string | null;
  name?: string | null;
};

function normalizeWhitespace(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeOptionalProjectLocationInput(
  value: string | null | undefined,
) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > MAX_PROJECT_LOCATION_LENGTH) {
    throw new ConvexError(
      `Project location cannot exceed ${MAX_PROJECT_LOCATION_LENGTH} characters`,
    );
  }

  return normalized;
}

export function normalizeProjectLocationInput(value: string) {
  const normalized = normalizeOptionalProjectLocationInput(value);

  if (!normalized) {
    throw new ConvexError("Project location is required");
  }

  return normalized;
}

export function readProjectLocation(project: ProjectLocationSource) {
  return (
    normalizeWhitespace(project.location) ??
    normalizeWhitespace(project.name)
  );
}

export function requireProjectLocation(project: ProjectLocationSource) {
  const location = readProjectLocation(project);

  if (!location) {
    throw new ConvexError("Project location is required");
  }

  return location;
}
