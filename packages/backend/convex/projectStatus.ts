import { v } from "convex/values";

export const PROJECT_STATUS_ACTIVE = "active" as const;
export const PROJECT_STATUS_DONE = "done" as const;

export const projectStatusValidator = v.union(
  v.literal(PROJECT_STATUS_ACTIVE),
  v.literal(PROJECT_STATUS_DONE),
);

export type ProjectStatus = typeof PROJECT_STATUS_ACTIVE | typeof PROJECT_STATUS_DONE;

export function resolveProjectStatus(status: ProjectStatus | undefined): ProjectStatus {
  return status === PROJECT_STATUS_DONE ? PROJECT_STATUS_DONE : PROJECT_STATUS_ACTIVE;
}

export function isProjectStatusActive(status: ProjectStatus | undefined) {
  return resolveProjectStatus(status) === PROJECT_STATUS_ACTIVE;
}
