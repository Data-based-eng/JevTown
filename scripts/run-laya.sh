#!/usr/bin/env bash
# Fully-local JevTown: Laya (System One decisions) + model proxy + Vite, one command.
#
# Usage: npm run play:laya   (or: just play-laya)
#
# What it starts, in order:
#   1. laya-server — the local System One endpoint (POST /v1/systemone), speaking the same
#      request/response shape as TypeSafe Jev. Skipped if something already answers /healthz.
#      Backend defaults to MLX on Apple Silicon (--backend mlx); set LAYA_BACKEND=torch
#      to use the PyTorch/MPS runtime instead.
#   2. model proxy — server/index.ts, holding keys and the 2000-call spend cap. The browser's
#      `laya` decider rides each /systemone call as `backend:"laya"`, and the proxy routes those
#      to LAYA_ENDPOINT (docs/13). The Jev cloud config (JEV_*) is left alone.
#   3. vite — the browser simulation, with VITE_ACTION_DECIDER=laya. Only vite: vite runs here;
#      the proxy from step 2 is already up, so `play:local` would start a second one.
#
# Ctrl-C stops everything this script started.
set -euo pipefail
cd "$(dirname "$0")/.."

LAYA_SERVER_DIR="${LAYA_SERVER_DIR:-../laya-server}"
LAYA_PORT="${LAYA_PORT:-8765}"
LAYA_MODELS="${LAYA_MODELS:-typed-decisions}"
LAYA_BACKEND="${LAYA_BACKEND:-mlx}"
LAYA_MLX_DTYPE="${LAYA_MLX_DTYPE:-float32}"
PROXY_PORT="${MODEL_PROXY_PORT:-3001}"

cleanup() {
  echo
  echo "[run-laya] stopping…"
  # shellcheck disable=SC2086
  kill ${LAYA_PID:-} ${PROXY_PID:-} 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. laya-server (skip if something already answers /healthz)
if curl -sf "http://127.0.0.1:${LAYA_PORT}/healthz" >/dev/null 2>&1; then
  echo "[run-laya] laya-server already listening on :${LAYA_PORT}"
else
  if [ ! -x "${LAYA_SERVER_DIR}/.venv/bin/python" ]; then
    echo "[run-laya] no venv at ${LAYA_SERVER_DIR}/.venv — see docs/13-laya-local-decider.md" >&2
    exit 1
  fi
  echo "[run-laya] starting laya-server (:${LAYA_PORT}, backend: ${LAYA_BACKEND}, models: ${LAYA_MODELS})…"
  if [ "${LAYA_BACKEND}" = "mlx" ]; then
    BACKEND_FLAGS=(--backend mlx --mlx-dtype "${LAYA_MLX_DTYPE}")
  else
    BACKEND_FLAGS=(--backend torch --device mps)
  fi
  (
    cd "${LAYA_SERVER_DIR}" && ./.venv/bin/python server.py \
      "${BACKEND_FLAGS[@]}" --models "${LAYA_MODELS}" --jev-alias --host 127.0.0.1 --port "${LAYA_PORT}" \
      >>laya-server.log 2>&1 &
    echo $! >.laya-server.pid
  )
  LAYA_PID="$(cat "${LAYA_SERVER_DIR}/.laya-server.pid")"
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:${LAYA_PORT}/healthz" >/dev/null 2>&1 && break
    sleep 5
  done
  curl -sf "http://127.0.0.1:${LAYA_PORT}/healthz" >/dev/null 2>&1 ||
    {
      echo "[run-laya] laya-server failed to come up — see ${LAYA_SERVER_DIR}/laya-server.log" >&2
      exit 1
    }
fi
curl -s "http://127.0.0.1:${LAYA_PORT}/healthz"
echo

# 2. model proxy — point it at laya-server through the LAYA_* config, leaving JEV_* (cloud) alone.
export LAYA_ENDPOINT="http://127.0.0.1:${LAYA_PORT}"
if [[ "${LAYA_MODELS}" == *"typed-decisions"* ]]; then
  export LAYA_MODEL="laya-typed-decisions"
else
  export LAYA_MODEL="laya-english"
fi
export MODEL_PROXY_PORT="${PROXY_PORT}"
node --experimental-strip-types server/index.ts &
PROXY_PID=$!
sleep 1

# 3. the simulation — vite only. The proxy above is already listening; `play:local` would
# start a second proxy on the same port.
echo "[run-laya] proxy on :${PROXY_PORT} (System One -> ${LAYA_ENDPOINT}, model ${LAYA_MODEL}), starting the browser sim…"
VITE_ACTION_DECIDER=laya npm run vite:local
