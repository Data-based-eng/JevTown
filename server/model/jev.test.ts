import { getJevConfig, getLayaConfig, checkLayaHealth, systemOne, normalizeUsage } from './jev';

describe('normalizeUsage', () => {
  // The shape the API actually returns, from a live call.
  test('renames the fields and totals them', () => {
    expect(normalizeUsage({ input_tokens: 425, output_tokens: 73 })).toEqual({
      input: 425,
      output: 73,
      total: 498,
    });
  });

  test('is undefined for anything without token counts', () => {
    for (const usage of [undefined, null, {}, 'lots', { cost: 1 }]) {
      expect(normalizeUsage(usage)).toBeUndefined();
    }
  });
});

describe('getJevConfig', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test('pins a version rather than following an alias', () => {
    delete process.env.JEV_MODEL;
    expect(getJevConfig().model).toBe('jev-1.13.0');
  });

  test('takes a gateway URL, without a trailing slash', () => {
    process.env.JEV_API_URL = 'https://nevatoken.com/';
    expect(getJevConfig().url).toBe('https://nevatoken.com');
  });
});

describe('getLayaConfig', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test('defaults to the loopback laya-server and the typed-decisions checkpoint', () => {
    delete process.env.LAYA_ENDPOINT;
    delete process.env.LAYA_MODEL;
    expect(getLayaConfig()).toEqual({
      url: 'http://127.0.0.1:8765',
      apiKey: undefined,
      model: 'laya-typed-decisions',
    });
  });

  test('honors overrides, without a trailing slash', () => {
    process.env.LAYA_ENDPOINT = 'http://127.0.0.1:9999/';
    process.env.LAYA_MODEL = 'laya-english';
    expect(getLayaConfig().url).toBe('http://127.0.0.1:9999');
    expect(getLayaConfig().model).toBe('laya-english');
  });

  test('is independent of the Jev cloud config', () => {
    process.env.JEV_API_URL = 'https://api.typesafe.ai';
    process.env.JEV_MODEL = 'jev-1.13.0';
    process.env.LAYA_ENDPOINT = 'http://127.0.0.1:8765';
    expect(getLayaConfig().url).not.toBe(getJevConfig().url);
    expect(getLayaConfig().model).not.toBe(getJevConfig().model);
  });
});

describe('systemOne backend routing', () => {
  const env = { ...process.env };
  const realFetch = global.fetch;
  const seen: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    seen.length = 0;
    global.fetch = ((url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ answers: {}, model: 'laya-english' }),
        text: () => Promise.resolve(''),
      } as Response);
    }) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...env };
    global.fetch = realFetch;
  });


interface SentBody {
  model?: string;
  backend?: unknown;
  trace?: unknown;
}

const sentBody = (index: number): SentBody =>
  JSON.parse(String(seen[index].init.body)) as SentBody;

  const body = {
    state: { you: 'Ava' },
    questions: { seek: { type: 'noul', instructions: 'Go?' } },
  } as Parameters<typeof systemOne>[0];

  test("backend 'laya' posts to LAYA_ENDPOINT, not the Jev cloud", async () => {
    process.env.LAYA_ENDPOINT = 'http://127.0.0.1:8765';
    delete process.env.LAYA_API_KEY;
    await systemOne({ ...body, backend: 'laya' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('http://127.0.0.1:8765/v1/systemone');
    const sent = sentBody(0);
    expect(sent.model).toBe('laya-typed-decisions');
    expect(sent.backend).toBeUndefined();
    expect(sent.trace).toBeUndefined();
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test("backend 'jev' posts to JEV_API_URL with the cloud key", async () => {
    process.env.JEV_API_URL = 'https://api.typesafe.ai';
    process.env.JEV_API_KEY = 'test-key';
    await systemOne({ ...body, backend: 'jev' });
    expect(seen[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(sentBody(0).model).toBe('jev-1.13.0');
  });

  test('absent backend keeps the historical default: jev', async () => {
    process.env.JEV_API_URL = 'https://api.typesafe.ai';
    await systemOne(body);
    expect(seen[0].url).toBe('https://api.typesafe.ai/v1/systemone');
  });

  test('an explicit model overrides the backend default', async () => {
    process.env.LAYA_ENDPOINT = 'http://127.0.0.1:8765';
    await systemOne({ ...body, backend: 'laya', model: 'laya-english' });
    expect(sentBody(0).model).toBe('laya-english');
  });
});

describe('checkLayaHealth', () => {
  const env = { ...process.env };
  const realFetch = global.fetch;
  afterEach(() => {
    process.env = { ...env };
    global.fetch = realFetch;
  });

  test('reports the checkpoint payload when /healthz answers', async () => {
    process.env.LAYA_ENDPOINT = 'http://127.0.0.1:8765';
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ok', loaded: ['laya-english'], device: 'mps' }),
      })) as unknown as typeof fetch;
    await expect(checkLayaHealth()).resolves.toEqual({
      reachable: true,
      status: 'ok',
      loaded: ['laya-english'],
      device: 'mps',
    });
  });

  test('reports unreachable instead of throwing when nothing listens', async () => {
    process.env.LAYA_ENDPOINT = 'http://127.0.0.1:9';
    global.fetch = (() =>
      Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9'))) as unknown as typeof fetch;
    const health = await checkLayaHealth(500);
    expect(health.reachable).toBe(false);
    expect(health.error).toMatch(/ECONNREFUSED/);
  });
});
