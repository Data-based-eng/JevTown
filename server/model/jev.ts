import { recordObservation } from './langfuse.ts';
import { retryWithBackoff } from './llm.ts';
import { watch } from '../../agent/model/watchdog.ts';
import type { ChatTrace, Observation } from '../../agent/model/trace.ts';
import type { SystemOneAnswers, SystemOneQuestions, LLMUsage } from '../../agent/model/client.ts';

/**
 * The System One provider (docs/12 §5).
 *
 * Deliberately not part of `getLLMConfig`. That function resolves two axes — a chat endpoint and an
 * embedding endpoint — and both speak the OpenAI wire format, which is what makes `LLMProvider` a
 * meaningful union. Jev speaks neither: no messages, no choices, no streaming, a different path.
 * Folding it in would mean a provider whose every branch is an exception, so it gets its own config
 * and its own file, following the `LLM_EMBEDDING_API_URL` precedent of a second independent axis.
 */

export interface JevConfig {
  /** No trailing slash. */
  url: string;
  apiKey: string | undefined;
  model: string;
}

export function getJevConfig(): JevConfig {
  return {
    url: (process.env.JEV_API_URL ?? 'https://api.typesafe.ai').replace(/\/+$/, ''),
    apiKey: process.env.JEV_API_KEY,
    // Pinned, not `jev-latest`. An alias moves when a release ships, and a world one can replay is
    // worth more here than one that silently gets a newer model's judgment.
    model: process.env.JEV_MODEL ?? 'jev-1.13.0',
  };
}

/** Which System One backend answers a call: TypeSafe's cloud Jev, or the local laya-server. */
export type SystemOneBackend = 'laya' | 'jev';

export interface LayaConfig {
  /** No trailing slash. */
  url: string;
  apiKey: string | undefined;
  model: string;
}

/**
 * The local System One backend (docs/13). Deliberately independent of the Jev cloud config
 * above: pointing the proxy at laya-server must not make the cloud backend unusable, and the
 * browser's `ACTION_DECIDER` picks which one a `/systemone` call goes to.
 */
export function getLayaConfig(): LayaConfig {
  return {
    url: (process.env.LAYA_ENDPOINT ?? 'http://127.0.0.1:8765').replace(/\/+$/, ''),
    apiKey: process.env.LAYA_API_KEY,
    // Pinned to the checkpoint fine-tuned on typed decisions, not the rolling `laya` alias.
    model: process.env.LAYA_MODEL ?? 'laya-typed-decisions',
  };
}

/** Liveness probe for the local backend — what `GET /llm/systemone/health` reports. */
export interface LayaHealth {
  reachable: boolean;
  status?: string;
  loaded?: string[];
  device?: string;
  error?: string;
}

export async function checkLayaHealth(timeoutMs = 2000): Promise<LayaHealth> {
  const { url } = getLayaConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url + '/healthz', { signal: controller.signal });
    if (!response.ok) return { reachable: false, error: `HTTP ${response.status}` };
    const json = (await response.json()) as {
      status?: string;
      loaded?: string[];
      device?: string;
    };
    return { reachable: true, status: json.status, loaded: json.loaded, device: json.device };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export interface SystemOneRequest {
  state: unknown;
  questions: SystemOneQuestions;
  model?: string;
  trace?: ChatTrace;
  /**
   * Which backend the proxy routes to. The browser's `ACTION_DECIDER`, threaded through so the
   * proxy doesn't have to guess (docs/13). Absent means the historical default, `'jev'`.
   */
  backend?: SystemOneBackend;
}

export interface SystemOneResponse {
  answers: SystemOneAnswers;
  model?: string;
  usage?: LLMUsage;
  retries: number;
  ms: number;
}

/** Output tokens are free and `usage` names its fields differently; normalize to ours. */
export function normalizeUsage(usage: unknown): LLMUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const { input_tokens: input, output_tokens: output } = usage as Record<string, unknown>;
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  return {
    input: typeof input === 'number' ? input : undefined,
    output: typeof output === 'number' ? output : undefined,
    total: typeof input === 'number' && typeof output === 'number' ? input + output : undefined,
  };
}

export async function systemOne(body: SystemOneRequest): Promise<SystemOneResponse> {
  const backend: SystemOneBackend = body.backend ?? 'jev';
  const config = backend === 'laya' ? getLayaConfig() : getJevConfig();
  // `trace` and `backend` are ours, not the provider's. Split them off before anything
  // serializes them onto the wire.
  const { trace, backend: _backend, ...rest } = body;
  const request = { ...rest, model: rest.model ?? config.model };
  const startTime = Date.now();
  try {
    const { result, retries, ms } = await retryWithBackoff(async () => {
      // Inside the retry rather than around it, so one attempt that never answers is visibly
      // different from three that failed fast and waited out the backoff. The enclosing
      // `stage()` in `server/index.ts` times the whole thing; this times each try at it.
      const attempt = watch(backend, `POST ${config.url}/v1/systemone (${request.model})`);
      const response = await fetch(config.url + '/v1/systemone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
        },
        body: JSON.stringify(request),
      }).catch((error: unknown) => {
        attempt(`no response: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      });
      attempt(`HTTP ${response.status}`);
      if (!response.ok) {
        const error = await response.text();
        console.error({ error });
        throw {
          retry: response.status === 429 || response.status >= 500,
          error: new Error(`System One call failed with code ${response.status}: ${error}`),
        };
      }
      const json = (await response.json()) as {
        answers?: SystemOneAnswers;
        model?: string;
        usage?: unknown;
      };
      if (typeof json.answers !== 'object' || json.answers === null) {
        throw new Error('Unexpected System One result: ' + JSON.stringify(json));
      }
      return { answers: json.answers, model: json.model, usage: normalizeUsage(json.usage) };
    });

    await report(trace, {
      request,
      answers: result.answers,
      model: result.model ?? request.model,
      usage: result.usage,
      startTime,
      retries,
      ms,
    });
    return { ...result, retries, ms };
  } catch (error) {
    // A failed call is worth a span too: a trace that simply stops has no explanation in it.
    await report(trace, { request, model: request.model, startTime, error });
    throw error;
  }
}

/**
 * A generation observation for a call with no messages and no completion.
 *
 * The questions are the interesting half of the input, so they go in `input` alongside the state,
 * and the typed answers — probabilities included — are the output. Langfuse will report zero cost
 * for a model it does not know, which is accurate enough: input is billed at $42 per billion
 * tokens, so a decision is worth about two hundredths of a cent.
 */
async function report(
  trace: ChatTrace | undefined,
  details: {
    request: { state: unknown; questions: SystemOneQuestions; model: string };
    answers?: SystemOneAnswers;
    model?: string;
    usage?: LLMUsage;
    startTime: number;
    retries?: number;
    ms?: number;
    error?: unknown;
  },
) {
  if (!trace) return;
  const { name, metadata, ...ref } = trace;
  const observation: Observation = {
    name,
    type: 'generation',
    startTime: details.startTime,
    endTime: Date.now(),
    input: { state: details.request.state, questions: details.request.questions },
    output: details.error ? undefined : details.answers,
    model: details.model,
    usage: details.usage,
    metadata: {
      ...metadata,
      ...(details.retries !== undefined ? { retries: details.retries } : {}),
      ...(details.ms !== undefined ? { providerMs: details.ms } : {}),
    },
    ...(details.error
      ? {
          level: 'ERROR' as const,
          statusMessage:
            details.error instanceof Error ? details.error.message : String(details.error),
        }
      : {}),
  };
  await recordObservation(ref, observation);
}
