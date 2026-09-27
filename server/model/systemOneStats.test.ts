import {
  createSystemOneStats,
  recordSystemOneCall,
  systemOneStatsSnapshot,
} from './systemOneStats';

const choice = (label: string, confidence?: number) => ({
  type: 'choice' as const,
  choice: label,
  confidence,
});

describe('systemOneStats', () => {
  test('starts empty', () => {
    expect(systemOneStatsSnapshot(createSystemOneStats())).toEqual({
      calls: 0,
      errors: 0,
      byModel: {},
      choices: {},
      confidenceBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      latencyMs: { count: 0, p50: undefined, p95: undefined, max: undefined },
    });
  });

  test('counts calls by answering model and errors separately', () => {
    const stats = createSystemOneStats();
    recordSystemOneCall(stats, {}, 'laya-typed-decisions', 45, false);
    recordSystemOneCall(stats, {}, 'laya-typed-decisions', 50, false);
    recordSystemOneCall(stats, {}, 'jev-1.13.0', 900, false);
    recordSystemOneCall(stats, undefined, undefined, 0, true);
    const snap = systemOneStatsSnapshot(stats);
    expect(snap.calls).toBe(3);
    expect(snap.errors).toBe(1);
    expect(snap.byModel).toEqual({ 'laya-typed-decisions': 2, 'jev-1.13.0': 1 });
  });

  test('tallies per-question choices, skipping non-choice answers', () => {
    const stats = createSystemOneStats();
    recordSystemOneCall(
      stats,
      {
        place: choice('the park', 0.8),
        idle_length: choice('stay put for a while', 0.4),
        seek: { type: 'noul', noul: 0.2, confidence: 0.8 },
      },
      'laya-english',
      46,
      false,
    );
    recordSystemOneCall(stats, { place: choice('the park', 0.9) }, 'laya-english', 44, false);
    expect(systemOneStatsSnapshot(stats).choices).toEqual({
      place: { 'the park': 2 },
      idle_length: { 'stay put for a while': 1 },
    });
  });

  test('confidence buckets clamp to [0, 9]', () => {
    const stats = createSystemOneStats();
    for (const confidence of [0.0, 0.05, 0.15, 0.95, 1.0, -0.5, 12]) {
      recordSystemOneCall(stats, { q: choice('a', confidence) }, 'm', 1, false);
    }
    // An answer with no confidence at all contributes no bucket.
    recordSystemOneCall(stats, { q: choice('a') }, 'm', 1, false);
    const buckets = systemOneStatsSnapshot(stats).confidenceBuckets;
    // 0.0 and 0.05 -> 0; 0.15 -> 1; 0.95 and 1.0 -> 9 (1.0 must not index 10);
    // -0.5 -> 0 and 12 -> 9 (clamped, never out of bounds).
    expect(buckets).toEqual([3, 1, 0, 0, 0, 0, 0, 0, 0, 3]);
  });

  test('keeps only the last 1000 latencies', () => {
    const stats = createSystemOneStats();
    for (let i = 1; i <= 1005; i++) recordSystemOneCall(stats, {}, 'm', i, false);
    expect(systemOneStatsSnapshot(stats).latencyMs.count).toBe(1000);
  });

  test('snapshot reports p50/p95/max over recorded latencies', () => {
    const stats = createSystemOneStats();
    for (let i = 1; i <= 100; i++) recordSystemOneCall(stats, {}, 'm', i, false);
    const { latencyMs } = systemOneStatsSnapshot(stats);
    expect(latencyMs.count).toBe(100);
    expect(latencyMs.p50).toBe(51);
    expect(latencyMs.p95).toBe(96);
    expect(latencyMs.max).toBe(100);
  });
});
