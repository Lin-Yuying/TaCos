import { TacosError } from "./tacos-error";

/**
 * Per-key token buckets. Reads and writes refill at 120/min and 60/min; both allow a
 * burst of 20. State lives in this process, like the existing badge polling: the team
 * server runs one Next.js process.
 */
export type ApiKeyRateMode = "read" | "write";

const LIMITS: Record<ApiKeyRateMode, { perMinute: number; burst: number }> = {
  read: { perMinute: 120, burst: 20 },
  write: { perMinute: 60, burst: 20 },
};

type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Partial<Record<ApiKeyRateMode, Bucket>>>();
const IDLE_MS = 10 * 60 * 1000;

export type ApiKeyRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function takeApiKeyToken(
  keyId: string,
  mode: ApiKeyRateMode,
  now: number = Date.now()
): ApiKeyRateLimitResult {
  const limit = LIMITS[mode];
  const capacity = Math.min(limit.burst, limit.perMinute);
  const refillPerMs = limit.perMinute / 60_000;
  let entry = buckets.get(keyId);
  if (!entry) {
    if (buckets.size > 5_000) {
      for (const [id, value] of buckets) {
        if (Math.max(value.read?.updatedAt ?? 0, value.write?.updatedAt ?? 0) < now - IDLE_MS) {
          buckets.delete(id);
        }
      }
    }
    entry = {};
    buckets.set(keyId, entry);
  }
  let bucket = entry[mode];
  if (!bucket) {
    bucket = { tokens: capacity, updatedAt: now };
    entry[mode] = bucket;
  } else {
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) };
}

/** Tests reset the in-memory buckets so one case cannot exhaust the next. */
export function resetApiKeyRateLimits() {
  buckets.clear();
}

export class ApiKeyRateLimitError extends TacosError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(
      "Rate limit exceeded for this API key",
      429,
      `Retry in ${retryAfterSeconds} seconds. Reads allow 120/min and writes 60/min, with a burst of 20.`
    );
    this.name = "ApiKeyRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
