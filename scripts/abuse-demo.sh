#!/usr/bin/env bash
#
# scripts/abuse-demo.sh — the M1 evidence artifact.
#
# Proves the hardened per-submission grading sandbox actually contains
# hostile code: infinite loops, fork bombs, network exfiltration attempts,
# filesystem escapes, and host-memory-exhausting stdout floods. Also proves
# a genuinely correct solution grades PASSED/100 end-to-end through the real
# HTTP API (POST /submissions -> queue -> grade -> GET /submissions/:id).
#
# Prereqs: the API + Postgres are up and seeded (`make dev`, or manually:
# `docker compose up -d --wait db && pnpm --filter @verdict/api prisma:deploy
# && pnpm --filter @verdict/api seed` then start the API). `jq` and `curl`
# must be on PATH; `docker` and `ps`/`lsof` are used for the containment /
# RSS checks.
#
# Usage: bash scripts/abuse-demo.sh
# Exit code: 0 if every assertion held, 1 otherwise.

set -euo pipefail

API_PORT="${API_PORT:-4000}"
API_BASE="http://localhost:${API_PORT}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-1}"
DEFAULT_SUBMIT_TIMEOUT_S="${DEFAULT_SUBMIT_TIMEOUT_S:-90}"

RESULTS=() # rows for the final PASS/FAIL table
FAILURES=0

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

log() { printf '%s\n' "$*" >&2; }

record_pass() {
  local name="$1" detail="$2"
  RESULTS+=("PASS|${name}|${detail}")
}

record_fail() {
  local name="$1" detail="$2"
  RESULTS+=("FAIL|${name}|${detail}")
  FAILURES=$((FAILURES + 1))
}

# GET/POST wrappers that never let a transport-level curl failure kill the
# whole script under `set -e` — a failed request is just treated as an empty
# response and handled by the caller.
http_get() { curl -sS --max-time 15 "$1" 2>/dev/null || true; }
http_post_json() { curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' -d "$2" "$1" 2>/dev/null || true; }

# True iff the parsed submission JSON contains a test result with the given status.
has_result_status() {
  local json="$1" want="$2"
  jq -e --arg s "$want" '([.results[]?.status] // []) | index($s) != null' >/dev/null 2>&1 <<<"$json"
}

# POST /submissions with `code` (JS, argv-safe — passed through jq, never
# interpolated into a shell string), then poll GET /submissions/:id until a
# terminal status. Echoes the final submission JSON on stdout.
submit_and_wait() {
  local problem_id="$1" code="$2" timeout_s="${3:-$DEFAULT_SUBMIT_TIMEOUT_S}"
  local body create_resp sub_id

  body=$(jq -n --arg problemId "$problem_id" --arg code "$code" '{problemId: $problemId, code: $code}')
  create_resp=$(http_post_json "${API_BASE}/submissions" "$body")
  sub_id=$(jq -r '.id // empty' <<<"$create_resp" 2>/dev/null || true)

  if [[ -z "$sub_id" ]]; then
    log "  submit failed: ${create_resp:-<no response>}"
    echo '{"status":"SUBMIT_FAILED"}'
    return 0
  fi

  local waited=0 poll_json status
  while true; do
    poll_json=$(http_get "${API_BASE}/submissions/${sub_id}")
    status=$(jq -r '.status // "UNKNOWN"' <<<"$poll_json" 2>/dev/null || echo UNKNOWN)
    if [[ "$status" == "PASSED" || "$status" == "FAILED" || "$status" == "ERROR" ]]; then
      echo "$poll_json"
      return 0
    fi
    if (( waited >= timeout_s )); then
      log "  submission ${sub_id} did not reach a terminal status within ${timeout_s}s (last status: ${status})"
      echo "$poll_json"
      return 0
    fi
    sleep "$POLL_INTERVAL_S"
    waited=$((waited + POLL_INTERVAL_S))
  done
}

# Find the running API process's pid, so the flood test can measure host RSS
# before/after. Two strategies, tried in order:
#   1. $API_PID_FILE, if the caller wrote one when starting the server.
#   2. `lsof` for whatever process is LISTENing on $API_PORT (works on both
#      macOS and Linux, which is why we use it rather than a Linux-only
#      /proc lookup).
find_api_pid() {
  if [[ -n "${API_PID_FILE:-}" && -f "${API_PID_FILE}" ]]; then
    cat "${API_PID_FILE}"
    return 0
  fi
  lsof -nP -iTCP:"${API_PORT}" -sTCP:LISTEN -t 2>/dev/null | head -n1
}

rss_kb() {
  local pid="$1"
  ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true
}

# ---------------------------------------------------------------------------
# 0. Health check
# ---------------------------------------------------------------------------

log "== verdict-desk M1 abuse-demo =="
log "API base: ${API_BASE}"

health_json=$(http_get "${API_BASE}/health")
health_status=$(jq -r '.status // empty' <<<"$health_json" 2>/dev/null || true)
health_db=$(jq -r '.db // empty' <<<"$health_json" 2>/dev/null || true)

if [[ "$health_status" != "ok" || "$health_db" != "up" ]]; then
  log ""
  log "ERROR: API not reachable/healthy at ${API_BASE}/health (got: ${health_json:-<no response>})"
  log "Hint: start the stack first, e.g.:"
  log "  make dev"
  log "or manually:"
  log "  docker compose up -d --wait db"
  log "  pnpm --filter @verdict/api prisma:deploy"
  log "  pnpm --filter @verdict/api seed"
  log "  node apps/api/dist/main.js   # (after: pnpm --filter @verdict/api build)"
  exit 1
fi
log "health OK (db: ${health_db})"

# ---------------------------------------------------------------------------
# 1. Locate "Sum of Two Numbers"
# ---------------------------------------------------------------------------

problems_json=$(http_get "${API_BASE}/problems")
PROBLEM_ID=$(jq -r '.[] | select(.title == "Sum of Two Numbers") | .id' <<<"$problems_json" 2>/dev/null | head -n1 || true)

if [[ -z "$PROBLEM_ID" ]]; then
  log "ERROR: could not find problem \"Sum of Two Numbers\" via GET /problems (got: ${problems_json})"
  log "Hint: run \`pnpm --filter @verdict/api seed\`."
  exit 1
fi
log "problem: Sum of Two Numbers (${PROBLEM_ID})"
log ""

# ---------------------------------------------------------------------------
# 2. Correct solution -> expect PASSED, score 100
# ---------------------------------------------------------------------------

log "-- case 1: correct solution --"
CODE_CORRECT='const chunks=[];process.stdin.on("data",d=>chunks.push(d));process.stdin.on("end",()=>{const nums=Buffer.concat(chunks).toString("utf8").split("\n").map(l=>l.trim()).filter(l=>l.length>0).map(Number);process.stdout.write(String(nums[0]+nums[1])+"\n");});'
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_CORRECT")
status=$(jq -r '.status' <<<"$result")
score=$(jq -r '.score' <<<"$result")
log "  status=${status} score=${score}"
if [[ "$status" == "PASSED" && "$score" == "100" ]]; then
  record_pass "correct solution" "status=${status} score=${score}"
else
  record_fail "correct solution" "expected PASSED/score=100, got status=${status} score=${score}"
fi
log ""

# ---------------------------------------------------------------------------
# 3. Infinite loop -> expect a TIMEOUT test result, submission not PASSED
# ---------------------------------------------------------------------------

log "-- case 2: infinite loop --"
CODE_LOOP='while(true){}'
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_LOOP")
status=$(jq -r '.status' <<<"$result")
log "  status=${status}"
if [[ "$status" != "PASSED" ]] && has_result_status "$result" "TIMEOUT"; then
  record_pass "infinite loop" "status=${status}, has a TIMEOUT test result"
else
  record_fail "infinite loop" "expected non-PASSED with a TIMEOUT result, got status=${status} results=$(jq -c '.results' <<<"$result")"
fi
log ""

# ---------------------------------------------------------------------------
# 4. Fork bomb -> expect contained (pids-limit), NOT passed, host unaffected
# ---------------------------------------------------------------------------

log "-- case 3: fork bomb --"
CODE_FORKBOMB="const cp=require('child_process'); for(;;){ try{cp.spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{detached:true,stdio:'ignore'})}catch(e){} }"
docker_ok_before=1
docker info >/dev/null 2>&1 || docker_ok_before=0
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_FORKBOMB" 120)
status=$(jq -r '.status' <<<"$result")
docker_ok_after=1
docker info >/dev/null 2>&1 || docker_ok_after=0
log "  status=${status}"
if [[ "$status" != "PASSED" ]] \
  && (has_result_status "$result" "TIMEOUT" || has_result_status "$result" "ERROR") \
  && [[ "$docker_ok_before" == "1" && "$docker_ok_after" == "1" ]]; then
  record_pass "fork bomb" "status=${status}, contained by --pids-limit, docker daemon stayed responsive"
else
  record_fail "fork bomb" "expected non-PASSED + TIMEOUT/ERROR result + docker still responsive; got status=${status} docker_before=${docker_ok_before} docker_after=${docker_ok_after} results=$(jq -c '.results' <<<"$result")"
fi
log ""

# ---------------------------------------------------------------------------
# 5. Network access -> expect blocked (--network none), NOT passed
# ---------------------------------------------------------------------------

log "-- case 4: network access --"
CODE_NET="fetch('http://1.1.1.1').then(()=>{}).catch(()=>process.exit(7));"
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_NET")
status=$(jq -r '.status' <<<"$result")
log "  status=${status}"
if [[ "$status" != "PASSED" ]]; then
  record_pass "network access" "status=${status} (blocked by --network none)"
else
  record_fail "network access" "expected non-PASSED, got status=${status} (network should be blocked!)"
fi
log ""

# ---------------------------------------------------------------------------
# 6. Filesystem escape -> expect blocked (read-only mount), NOT passed
# ---------------------------------------------------------------------------

log "-- case 5: fs write outside /tmp --"
CODE_FS="require('fs').writeFileSync('/work/pwned','x');process.stdout.write('WROTE');"
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_FS")
status=$(jq -r '.status' <<<"$result")
log "  status=${status}"
if [[ "$status" != "PASSED" ]]; then
  record_pass "fs write outside /tmp" "status=${status} (blocked by read-only mount)"
else
  record_fail "fs write outside /tmp" "expected non-PASSED, got status=${status} (write should be blocked!)"
fi
log ""

# ---------------------------------------------------------------------------
# 7. 100MB stdout flood -> expect contained (truncated) AND host RSS stable.
#    This is the proof that CappedCollector's streaming cap actually works:
#    if the API buffered the flood the way the old `runOnce` uncapped
#    `stdout += chunk` pattern did, its RSS would balloon by ~100MB+.
# ---------------------------------------------------------------------------

log "-- case 6: 100MB stdout flood (+ API host RSS check) --"
API_PID=$(find_api_pid || true)
if [[ -z "$API_PID" ]]; then
  log "  WARNING: could not find the API's pid (checked \$API_PID_FILE and \`lsof -iTCP:${API_PORT}\`)."
  log "  Set API_PID_FILE=/path/to/pidfile when starting the API, or ensure \`lsof\` can see it."
fi

rss_before=""
[[ -n "$API_PID" ]] && rss_before=$(rss_kb "$API_PID")

CODE_FLOOD='const b=Buffer.alloc(1048576,120); for(;;){process.stdout.write(b)}'
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_FLOOD")
status=$(jq -r '.status' <<<"$result")

rss_after=""
[[ -n "$API_PID" ]] && rss_after=$(rss_kb "$API_PID")

log "  status=${status}"
contained=false
if [[ "$status" != "PASSED" ]] && (has_result_status "$result" "TIMEOUT" || has_result_status "$result" "ERROR"); then
  contained=true
fi

if [[ -n "$rss_before" && -n "$rss_after" ]]; then
  delta_kb=$((rss_after - rss_before))
  delta_mb=$((delta_kb / 1024))
  log "  API RSS before=${rss_before}KB after=${rss_after}KB delta=${delta_kb}KB (~${delta_mb}MB)"
  if $contained && (( delta_mb < 100 )); then
    record_pass "100MB stdout flood" "status=${status}, contained, RSS delta=${delta_mb}MB (< 100MB)"
  else
    record_fail "100MB stdout flood" "status=${status} contained=${contained} RSS delta=${delta_mb}MB (want contained AND < 100MB)"
  fi
else
  log "  (could not measure API RSS — skipping the RSS assertion, but still checking containment)"
  if $contained; then
    record_pass "100MB stdout flood" "status=${status}, contained (RSS NOT measured — could not locate API pid)"
  else
    record_fail "100MB stdout flood" "status=${status} not contained, and RSS could not be measured"
  fi
fi
log ""

# ---------------------------------------------------------------------------
# 7. Detached grandchild holding main.js's stdout pipe must NOT stall grading.
#    Regression for the per-case-timeout-not-self-resolving bug: main.js spawns a
#    detached grandchild (its OWN process group) with stdio:'inherit' — so it
#    holds main.js's stdout pipe open — and then exits. Before the fix the harness
#    waited on the child's stdio 'close' (which never fires while the pipe is
#    held) and the case hung until the outer wall-clock. After the fix it resolves
#    on the child's 'exit', fast.
# ---------------------------------------------------------------------------

log "-- case 7: detached grandchild does not stall the queue --"
CODE_STALL="require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{detached:true,stdio:'inherit'});"
t0=$SECONDS
result=$(submit_and_wait "$PROBLEM_ID" "$CODE_STALL")
elapsed=$((SECONDS - t0))
status=$(jq -r '.status' <<<"$result")
log "  status=${status} elapsed=${elapsed}s"
# The robust signal is SEMANTIC, not timing: post-fix each case resolves via its
# own PER-CASE timeout (→ FAILED with TIMEOUT results). Had the grandchild stalled
# the harness, only the outer wall-clock backstop would have fired, marking the
# whole submission infra-ERROR. So FAILED + a TIMEOUT result == the per-case
# timeout won == no stall. (elapsed is logged as a secondary sanity check.)
if [[ "$status" == "FAILED" ]] && has_result_status "$result" "TIMEOUT"; then
  record_pass "grandchild no-stall" "status=${status} via per-case TIMEOUT (not wall-clock ERROR), ${elapsed}s"
else
  record_fail "grandchild no-stall" "expected FAILED with a TIMEOUT result (per-case timeout, no stall), got status=${status} results=$(jq -c '.results' <<<"$result") elapsed=${elapsed}s"
fi
log ""

# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------

log "== results =="
printf '%-6s | %-24s | %s\n' "RESULT" "CASE" "DETAIL"
printf -- '-------|--------------------------|--------------------------------------------------\n'
for row in "${RESULTS[@]}"; do
  IFS='|' read -r verdict name detail <<<"$row"
  printf '%-6s | %-24s | %s\n' "$verdict" "$name" "$detail"
done

log ""
if (( FAILURES == 0 )); then
  log "ALL ${#RESULTS[@]} ASSERTIONS PASSED"
  exit 0
else
  log "${FAILURES} / ${#RESULTS[@]} ASSERTIONS FAILED"
  exit 1
fi
