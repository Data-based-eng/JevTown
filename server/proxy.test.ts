/**
 * The model proxy, live: routing, health, stats, and the 2000-call spend cap — without any real
 * upstream. Both System One backends point at a closed port, so a routed call fails fast (502)
 * instead of hanging, and the assertions are about what the proxy itself does.
 *
 * Heavier than a unit test, so it owns its own file and its own port.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 13971;

async function waitForProxy(child: ChildProcess, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/llm/systemone/stats`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error('proxy did not become ready in time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('model proxy (server/index.ts)', () => {
  let child: ChildProcess;

  beforeAll(async () => {
    child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'server/index.ts'],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MODEL_PROXY_PORT: String(PORT),
          MODEL_PROXY_CALL_CAP: '1',
          // Closed port: routed calls fail fast with 502, never hang, never touch the network.
          LAYA_ENDPOINT: 'http://127.0.0.1:9',
          LAYA_MODEL: 'laya-typed-decisions',
          JEV_API_URL: 'http://127.0.0.1:9',
          JEV_API_KEY: 'test-key',
        },
      },
    );
    await waitForProxy(child);
  }, 45000);

  afterAll(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!child.killed) child.kill('SIGKILL');
  });

  test('GET /llm/systemone/stats reports the session counters', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/llm/systemone/stats`);
    expect(response.status).toBe(200);
    const stats = (await response.json()) as {
      calls: number;
      errors: number;
      byModel: Record<string, number>;
      confidenceBuckets: number[];
      latencyMs: { count: number; p50?: number; p95?: number; max?: number };
    };
    expect(stats.calls).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.confidenceBuckets).toHaveLength(10);
    expect(stats.latencyMs.count).toBe(0);
  });

  test('GET /llm/systemone/health reports backends and laya reachability, without keys', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/llm/systemone/health`);
    expect(response.status).toBe(200);
    const health = (await response.json()) as {
      backends: { jev: { url: string; model: string }; laya: { url: string; model: string } };
      laya: { reachable: boolean; error?: string };
    };
    expect(health.backends.laya).toEqual({
      url: 'http://127.0.0.1:9',
      model: 'laya-typed-decisions',
    });
    expect(health.backends.jev.url).toBe('http://127.0.0.1:9');
    expect(health.laya.reachable).toBe(false);
    expect(JSON.stringify(health)).not.toContain('test-key');
  });

  test('the call cap still bites, even on the local path', async () => {
    const post = () =>
      fetch(`http://127.0.0.1:${PORT}/llm/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'x',
          questions: {},
          backend: 'laya',
        }),
      });
    // First call is attempted (and fails upstream, 502); the second hits the cap of 1.
    expect((await post()).status).toBe(502);
    const capped = await post();
    expect(capped.status).toBe(429);
    expect(await capped.text()).toMatch(/cap/);

    const stats = (await (
      await fetch(`http://127.0.0.1:${PORT}/llm/systemone/stats`)
    ).json()) as { calls: number; errors: number };
    expect(stats.errors).toBe(1);
    expect(stats.calls).toBe(0);
  });
});
