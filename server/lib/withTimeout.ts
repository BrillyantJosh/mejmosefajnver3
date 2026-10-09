/**
 * A deadline for one heartbeat job, so a hung relay query cannot stall the
 * heartbeat forever.
 *
 * Resolves with the job's own result when the job settles first, or with
 * `undefined` (and one "⏰ … timed out" warning) when the deadline passes
 * first. It does NOT cancel the job — a late job keeps running and its result
 * is simply dropped. A job that rejects still rejects.
 *
 * Until 9. 10. 2026 the deadline timer was never cleared, so the warning was
 * logged `ms` after EVERY run, also when the job had finished long before:
 * production showed "indexUnconditionalFinancingFromRelays timed out after
 * 120s" exactly two minutes after each successful re-index. A real timeout
 * looked the same as a good run. The timer is now cleared as soon as the job
 * settles, so the warning means the deadline really came first.
 *   npx tsx scripts/testWithTimeout.ts
 */
export function withTimeout<T>(fn: () => Promise<T>, label: string, ms: number): Promise<T | undefined> {
  // Start the job before the timer: a job that throws synchronously throws
  // from here, as before, and leaves no timer behind.
  const job = fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`⏰ ${label} timed out after ${ms / 1000}s — skipping this cycle`);
      resolve(undefined);
    }, ms);
  });
  return Promise.race([job, deadline]).finally(() => clearTimeout(timer));
}
