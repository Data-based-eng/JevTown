import type { SystemOneAnswers } from '../../agent/model/client.ts';

// ---------------------------------------------------------------- System One stats (docs/13 §5)
//
// Session-scoped metrics for the `/systemone` route: latency percentiles, which backend answered
// (`laya-typed-decisions` vs `jev-1.13.0`), per-question choice distributions, and a confidence
// histogram. Cheap to keep, free to read (`GET /llm/systemone/stats`), and deliberately not
// persisted — a long run restarts the proxy anyway, and per-call latency already lands in
// `llm_calls` when a database is configured.
//
// Pure functions over an explicit state object (created per proxy process in `server/index.ts`),
// so the behavior is unit-testable without importing the HTTP server.
export interface SystemOneStats {
  calls: number;
  errors: number;
  /** Answered-by model id. */
  byModel: Record<string, number>;
  /** question id -> chosen option label -> times picked. */
  choices: Record<string, Record<string, number>>;
  /** 10 buckets over [0, 1] for `choice` answers' confidence. */
  confidenceBuckets: number[];
  /** The last 1000 upstream latencies, ms — enough for p50/p95 on a session. */
  latenciesMs: number[];
}

export function createSystemOneStats(): SystemOneStats {
  return {
    calls: 0,
    errors: 0,
    byModel: {},
    choices: {},
    confidenceBuckets: new Array<number>(10).fill(0),
    latenciesMs: [],
  };
}

export function recordSystemOneCall(
  stats: SystemOneStats,
  answers: SystemOneAnswers | undefined,
  model: string | undefined,
  latencyMs: number,
  failed: boolean,
): void {
  if (failed) {
    stats.errors += 1;
    return;
  }
  stats.calls += 1;
  if (model) stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;
  stats.latenciesMs.push(latencyMs);
  if (stats.latenciesMs.length > 1000) stats.latenciesMs.shift();
  for (const [questionId, answer] of Object.entries(answers ?? {})) {
    if (answer?.type !== 'choice' || typeof answer.choice !== 'string') continue;
    const perQuestion = (stats.choices[questionId] ??= {});
    perQuestion[answer.choice] = (perQuestion[answer.choice] ?? 0) + 1;
    if (typeof answer.confidence === 'number') {
      // Clamped both ways: a confidence of exactly 1 lands in bucket 9, and a wayward
      // negative (or NaN-shaped) value can never index outside the array.
      const bucket = Math.max(0, Math.min(9, Math.floor(answer.confidence * 10)));
      stats.confidenceBuckets[bucket] += 1;
    }
  }
}

export function systemOneStatsSnapshot(stats: SystemOneStats) {
  const sorted = [...stats.latenciesMs].sort((a, b) => a - b);
  const quantile = (q: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : undefined;
  return {
    calls: stats.calls,
    errors: stats.errors,
    byModel: stats.byModel,
    choices: stats.choices,
    confidenceBuckets: stats.confidenceBuckets,
    latencyMs: {
      count: sorted.length,
      p50: quantile(0.5),
      p95: quantile(0.95),
      max: sorted[sorted.length - 1],
    },
  };
}
