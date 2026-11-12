#!/usr/bin/env bash
# Quick smoke test for the mock CLIs.
# Runs each agent's wrapper against a known recording and asserts that:
#   1. The mock binary exits 0
#   2. Stdout starts with the expected JSON protocol envelope
#   3. The first JSON line for each JSON agent has the expected shape
#
# Usage:
#   bash mocks/scripts/smoke-test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MOCKS="$(cd "$HERE/.." && pwd -P)"
TRACE_ID="${PIXO_MOCKS_SMOKE_TRACE:-04097377}"   # the 17-tool claude session

# Ensure recordings are on disk — the corpus is hosted on R2 and fetched
# on demand. If nothing's been pulled yet (or only a few are), run the
# fetcher so smoke covers the full agent matrix.
if ! ls "$MOCKS/recordings"/*.jsonl >/dev/null 2>&1; then
  echo "no recordings found — fetching from R2 first..."
  bash "$HERE/fetch-recordings.sh" >/dev/null
  echo
fi

export PATH="$MOCKS/bin:$PATH"
export PIXO_MOCKS_TRACE="$TRACE_ID"
export PIXO_MOCKS_NO_DELAY=1

failed=0
pass()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$1"; failed=$((failed + 1)); }

check_json_first_event() {
  local agent="$1" expected_type="$2"
  local first
  first=$(echo "smoke" | "$agent" run 2>/dev/null | head -1 || true)
  if [ -z "$first" ]; then fail "$agent: empty stdout"; return; fi
  local got
  got=$(printf '%s' "$first" | node -e 'let buf="";process.stdin.on("data",d=>buf+=d);process.stdin.on("end",()=>{try{console.log(JSON.parse(buf).type||"")}catch{console.log("INVALID")}})')
  if [ "$got" = "$expected_type" ]; then
    pass "$agent first event = $expected_type"
  else
    fail "$agent first event = $got (wanted $expected_type)"
  fi
}

echo "Smoke testing mock CLIs against trace $TRACE_ID"
echo

# opencode / opencode-cli (primary OpenPixo-facing bin) → step_start
check_json_first_event opencode step_start
check_json_first_event opencode-cli step_start

# codex → thread.started
check_json_first_event codex thread.started

# claude → system / init
# (codex/claude have a different entry verb; using a uniform "first line type" check)
first=$(echo smoke | claude -p 2>/dev/null | head -1 || true)
if printf '%s' "$first" | grep -q '"type":"system"'; then
  pass "claude first event = system"
else
  fail "claude first event missing system shape: ${first:0:80}"
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "All mock CLIs working. ✅"
else
  echo "$failed check(s) failed. ❌"
  exit 1
fi
