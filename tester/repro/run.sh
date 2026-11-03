#!/usr/bin/env bash
# Runs the QA reproductions on an in-memory database (PGlite), with the API package's own dependencies.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
api="$here/../../apps/api"
ln -sfn "$api/node_modules" "$here/node_modules"
cat > "$here/vitest.config.mjs" <<'CFG'
export default { test: { environment: "node", testTimeout: 30000, hookTimeout: 60000, include: ["repro.test.ts"] } };
CFG
"$api/node_modules/.bin/vitest" run --root "$here" --silent=false --reporter=verbose 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "QA-|Dan sees|'|Tests"
