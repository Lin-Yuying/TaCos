import { normalizePriority, normalizeStatus, TacosError, type Priority, type Status } from "./issues";

export function parseStatus(value: unknown): Status | undefined {
  if (value === undefined || value === null) return undefined;
  const status = normalizeStatus(value);
  if (!status) {
    throw new TacosError(
      `Invalid status ${JSON.stringify(value)}`,
      400,
      "Valid statuses: todo, in_progress, done, canceled"
    );
  }
  return status;
}

export function parsePriority(value: unknown): Priority | undefined {
  if (value === undefined || value === null) return undefined;
  const priority = normalizePriority(value);
  if (priority === null) {
    throw new TacosError(
      `Invalid priority ${JSON.stringify(value)}`,
      400,
      "Valid priorities: none (0), low (1), medium (2), high (3), urgent (4)"
    );
  }
  return priority;
}

export function parseLabelNames(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value;
  }
  throw new TacosError("labels must be an array of strings or a comma-separated string", 400);
}
