/**
 * The few settings the agent layer reads, from wherever it happens to be running.
 *
 * These were `process.env` lookups, which was correct while every one of them ran in a Convex
 * action. The agent layer runs in a browser now, where `process` does not exist and reading it
 * throws on the first decision — so each setting is read through here instead: `import.meta.env`
 * in a bundle (Vite only exposes `VITE_`-prefixed names to the client), `process.env` in Node for
 * tests and the proxy.
 *
 * Read per call rather than captured at module load, so a test can change one.
 */

function setting(name: string): string | undefined {
  const fromBundle = ((import.meta as any).env ?? {})[`VITE_${name}`];
  if (fromBundle !== undefined) return fromBundle as string;
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

/** Skip memory entirely, for a backend with no embedding model configured. */
export function memoryDisabled(): boolean {
  return setting('DISABLE_MEMORY') === 'true';
}

/** How many memories a conversation prompt retrieves. Falls back to the engine constant. */
export function numMemoriesToSearch(fallback: number): number {
  return Number(setting('NUM_MEMORIES_TO_SEARCH')) || fallback;
}

/** The temporary probe of docs/08 §7 D7. See `agent/god.ts`. */
export function mysteryGiftEnabled(): boolean {
  return setting('GOD_MYSTERY_GIFT') === '1';
}

export type ActionDecider = 'llm' | 'jev' | 'laya';

/**
 * Which decider answers the *action* decision -- what to do next -- the chat model or a
 * System One model (docs/12 §2). Named for the decision rather than for the agent, because it is one of several an
 * agent makes: `ACTION_DECIDER` is a sibling of whatever eventually chooses how state is written.
 *
 * A flag rather than a replacement, because the two are not equivalent — the System One deciders
 * drop the prose the chat one writes. Keeping every setting selectable is also what makes them
 * comparable: same manifest, same world, one variable.
 *
 * `laya` is the local System One backend: a laya-server behind the proxy's `JEV_API_URL`, speaking
 * the same typed-decision request/response shape as Jev (docs/13). Which backend actually answers
 * a `/systemone` call is a proxy concern, not a browser one — the browser only chooses between
 * the chat-model branch and the System One branch.
 */
export function decider(): ActionDecider {
  const raw = setting('ACTION_DECIDER');
  return raw === 'jev' || raw === 'laya' ? raw : 'llm';
}

/** True for both System One backends — Jev and Laya take the same branch (docs/12 §1). */
export function deciderIsSystemOne(): boolean {
  return decider() !== 'llm';
}

/**
 * After how many consecutive idles the Jev decider starts leaning against another one
 * (`SUPPRESS_IDLE_AFTER=6`, docs/12 §4). Unset -- the default -- means never: the gates in
 * `decideJev.ts` stand wherever the answers put them.
 *
 * Read as a count rather than as a duration because that is what the decider can see: a streak is
 * a property of the decisions, and how long each of them lasted is the model's business.
 */
export function suppressIdleAfter(): number | undefined {
  const raw = setting('SUPPRESS_IDLE_AFTER');
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const after = Number(raw);
  return Number.isFinite(after) && after > 0 ? after : undefined;
}
