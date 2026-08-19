// Job retry backoff with full jitter (Milestone 6).
//
// Pure logic, no I/O. The retry classifiers (classifyEnhancementError /
// classifyGenerationError) stay deterministic; jitter is applied only here,
// at the envelope, so a burst of failures does not re-fire in lockstep.
// Algorithm: Full Jitter (AWS Exponential Backoff And Jitter):
//   cap = min(base * 2^(attempt-1), maxMs); delay = uniform(0, cap).

export type JitterRandom = (min: number, max: number) => number;

export type BackoffOptions = {
  baseMs?: number;
  maxMs?: number;
  random?: JitterRandom;
};

// Exponential cap for an attempt. `attemptCount` is the job's attempt_count
// after the current (failed) claim, i.e. >= 1.
export function computeBackoffCapMs(attemptCount: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = baseMs * 2 ** exponent;
  return Math.min(raw, maxMs);
}

export function computeBackoffDelayMs(attemptCount: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? 60_000;
  const maxMs = options.maxMs ?? 8 * 60_000;
  const random = options.random ?? Math.random;

  const cap = computeBackoffCapMs(attemptCount, baseMs, maxMs);
  // random returns a value in [min, max); delay is in [0, cap).
  return Math.floor(random(0, cap));
}
