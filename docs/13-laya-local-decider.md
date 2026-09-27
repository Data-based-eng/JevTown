# 13. The local System One decider (Laya)

JevTown's action decider — *what to do next* — has three settings (`agent/config.ts`):

| `ACTION_DECIDER` | Backend | Runs where | Needs |
|---|---|---|---|
| `llm` | Chat model | Wherever `LLM_API_URL` points | An OpenAI-compatible endpoint |
| `jev` | TypeSafe Jev | api.typesafe.ai | `JEV_API_KEY` |
| `laya` | Laya (local) | This machine, via laya-server | The checkpoint downloads below |

`laya` is the fully-local System One path: a laya-server process answers
`POST /v1/systemone` with the same typed request/response shape Jev uses, the proxy forwards
it (still holding the keys, still enforcing the 2,000-call process cap), and the browser-side
`decideJev.ts` mapping is untouched — illegal actions still cannot enter the engine, because
labels map back to manifest IDs through `choice` gates exactly as in the Jev path (docs/12 §1).

## Architecture

```
browser (VITE_ACTION_DECIDER=laya)
  │  POST /llm/systemone   (typed System One request: state + questions, backend:"laya")
  ▼
model proxy (server/index.ts :3001)
  │  routes on the request's `backend` field (server/model/jev.ts):
  │    "laya" → POST {LAYA_ENDPOINT}/v1/systemone   (default http://127.0.0.1:8765)
  │    "jev"  → POST {JEV_API_URL}/v1/systemone    (TypeSafe cloud, needs JEV_API_KEY)
  ▼
laya-server (:8765, FastAPI, --backend mlx)
  │  laya-typed-decisions checkpoint (421M, fine-tuned on typed decisions),
  │  served by the native MLX runtime (laya-mlx) — no torch, no transformers
  ▼
answers: { choice: {...}, score: {...}, noul: {...} }
```

The two System One backends have independent proxy config on purpose: `LAYA_ENDPOINT` /
`LAYA_MODEL` for the local server, `JEV_API_URL` / `JEV_MODEL` / `JEV_API_KEY` for the cloud.
Pointing at laya-server never makes the cloud backend unusable — the browser's decider picks
per call, and `npm run play:local:jev` genuinely reaches TypeSafe.

The proxy also serves two free (cap-exempt) observability endpoints:

- `GET /llm/systemone/stats` — per-session calls/errors, latency p50/p95/max, which model
  answered, per-question choice distributions, and a 10-bucket confidence histogram.
- `GET /llm/systemone/health` — the configured backends (URLs and models, never keys) plus a
  live laya-server `/healthz` probe: reachability, loaded checkpoints, device.

Dialogue, memory, and beliefs stay on the chat model (`/llm/chat` → `LLM_API_URL`, e.g. Ollama)
— Laya only replaces the *action* decision.

## One-command startup

```bash
npm run play:laya        # or: just play-laya
```

`scripts/run-laya.sh` starts laya-server if nothing answers `:8765/healthz`, then the proxy with
`LAYA_ENDPOINT=http://127.0.0.1:8765` (and `LAYA_MODEL` derived from `LAYA_MODELS`), then
`vite --mode memory` with `VITE_ACTION_DECIDER=laya` — vite only, because the proxy is already
up and `play:local` would start a second one on the same port. Ctrl-C stops everything it started.

Environment knobs (all optional): `LAYA_SERVER_DIR` (default `../laya-server`), `LAYA_PORT`
(default `8765`), `LAYA_MODELS` (default `typed-decisions`), `LAYA_BACKEND` (default `mlx`;
`torch` selects the PyTorch/MPS runtime), `LAYA_MLX_DTYPE` (default `float32`; `float16` is
faster on long states with slight confidence drift), `MODEL_PROXY_PORT` (default `3001`).

## Manual setup

Prerequisites: Apple Silicon Mac, Python 3.12, Node 22, ~4 GB disk for checkpoints.

```bash
# 1. The System One server (pinned; see the commit in scripts/run-laya.sh history)
git clone https://github.com/noahbclarkson/laya-server.git ../laya-server
cd ../laya-server && git checkout 819fa065dce72b3c117a2364bb4839c02a0abcb3
python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/pip install mlx laya-mlx   # the MLX backend (Apple Silicon)
# First run downloads the checkpoints from Hugging Face. If downloads stall at 0%,
# retry with HF_HUB_DISABLE_XET=1 (hf-xet can hang on some networks).

# 2. JevTown deps and env
cd ../jevtown && npm ci
cp .env.local.example .env.local   # shipped with local defaults; edit as needed

# 3. (Optional, for dialogue/memory) the chat model
brew install ollama
ollama pull llama3.1:8b nomic-embed-text
```

`.env.local` (gitignored) holds the local defaults: `VITE_ACTION_DECIDER=laya`,
`LAYA_ENDPOINT`/`LAYA_MODEL` for the local backend, the untouched `JEV_*` cloud config, and the
Ollama `LLM_*` endpoints. The proxy loads it automatically (explicit environment wins); the
browser reads the `VITE_` names at build time.

## Comparing the three deciders

Same manifest, same world, one variable — that is the point of the flag:

```bash
npm run play:laya        # local Laya
npm run play:local:jev   # TypeSafe cloud (needs JEV_API_KEY)
npm run play:local        # chat-model decider (VITE_ACTION_DECIDER=llm)
```

Watch `GET http://127.0.0.1:3001/llm/systemone/stats` during a run for the
decision-distribution and confidence side of the comparison.

## Backends

`laya-server --backend` selects the inference runtime; the wire format and the answers are the
same either way:

| Backend | Runtime | 5-question p95 (M4 Pro) | Notes |
|---|---|---|---|
| `mlx` (default) | laya-mlx, native Metal | **≈ 60 ms** via HTTP (float32) | Same labels as torch on validation fixtures; loads in ~1 s; `mx.clear_cache()` after every request bounds Metal memory |
| `torch` | PyTorch 2.14, MPS fp32 | ≈ 65 ms via HTTP | Compatibility baseline; fp16 crashes in MPS matmuls, so fp32 is pinned |

Measured 2026-09-27 on the `laya-typed-decisions` checkpoint (335 input tokens, 30 runs,
warmed). The 3-question decision (the common JevTown shape) answers at p95 ≈ 40 ms on MLX.
`--mlx-dtype float16` shaves ~10–15% on long states at the cost of slight confidence drift;
float32 is the default because it matches the torch backend exactly.

## Known limitations

- **Latency vs state length.** The numbers above are for the standard fixture. Latency grows
  roughly quadratically with per-question sequence length on either backend (MLX fp16:
  ~390 ms at ~630 tokens/question; torch/MPS: ~520 ms). Very long manifests will exceed the
  80 ms p95 target — that is model physics for a 421M encoder, not overhead. Watch the live
  numbers at `GET /llm/systemone/stats` during a run.
- **Zero-shot quality is weak by design.** The base checkpoints are documented as weak zero-shot;
  the `typed-decisions` checkpoint is fine-tuned for the typed-decision workflow but still
  expects application-shaped data. Treat the first runs as calibration: the confidence
  histogram in `/systemone/stats` tells you whether the model is decisive or guessing.
- **Confidence calibration.** laya-server clamps out-of-range checkpoint temperatures at load
  (`RuntimeWarning: ... clamping choice:11+=0.1006`); treat confidence from the affected buckets
  as uncalibrated.
- **Context.** The english checkpoint has a shorter context window than `typed-decisions`;
  long manifests truncate, and laya-server reports truncation in its logs.
- **The 2,000-call cap still applies** to the local path too — a runaway loop is a runaway loop.
  Raise `MODEL_PROXY_CALL_CAP` for long soaks deliberately.
