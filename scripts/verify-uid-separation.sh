#!/usr/bin/env bash
#
# scripts/verify-uid-separation.sh — proves the /proc/1/fd/1 self-injection
# residual (documented in the README threat model) is CLOSED: the harness
# (PID 1, tini's child) now runs as in-container root, and every submission
# child it spawns is dropped to a DISTINCT, unprivileged uid/gid (65534) via
# Node's `spawn(..., { uid, gid })` — see harness.js. Because the submission
# no longer shares a uid with PID 1, it can no longer open /proc/1/fd/1 (that
# fd is now owned by a uid the submission doesn't have).
#
# Unlike verify-destructive.sh (which drives the real HTTP API), this spike
# talks to Docker DIRECTLY, using the actual built `buildDockerRunArgs` +
# `harness.js` — the same two artifacts `runner.service.ts#runSubmission`
# uses — so the argv and harness code under test are byte-identical to
# production, not a re-implementation.
#
# Four proofs, in order:
#   1. hostile submission: fs.writeFileSync('/proc/1/fd/1', ...) -> EACCES/EPERM,
#      and the harness's overall result stream stays intact (other cases OK).
#   2. id-check: the submission child sees uid 65534; a second, separate
#      docker run (same buildDockerRunArgs, no --user flag) proves PID 1
#      itself is uid 0.
#   3. a normal correct solution still grades PASS through the same path.
#   4. regression: writing to /work and an outbound network attempt still
#      fail as before (2 of verify-destructive.sh's destructive classes).
#
# Prereqs: docker, node, jq, pnpm on PATH; run from the repo root.
# Exit code: 0 if all four proofs hold, 1 otherwise.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
HARNESS_SRC="$API_DIR/src/sandbox/harness/harness.js"
TSX="$API_DIR/node_modules/.bin/tsx"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/verdict-uidspike-work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

FAILURES=0
pass() { printf '  \xe2\x9c\x93 %s\n' "$*"; }
fail() { printf '  \xe2\x9c\x97 FAIL: %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
section() { printf '\n=== %s ===\n' "$*"; }

[ -x "$TSX" ] || { echo "ERROR: tsx not found at $TSX (run pnpm install)"; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker not on PATH"; exit 1; }
command -v jq >/dev/null || { echo "ERROR: jq not on PATH"; exit 1; }

# ---------------------------------------------------------------------------
# Helper: print the EXACT docker run argv (as a JSON array) that
# runner.service.ts would produce, by importing the real, built
# buildDockerRunArgs — never a hand-rolled re-implementation.
# ---------------------------------------------------------------------------
ARGS_HELPER="$WORK/print-args.ts"
cat > "$ARGS_HELPER" <<TSEOF
import { buildDockerRunArgs } from '$API_DIR/src/sandbox/docker-args';

const [containerName, hostTmpDir, entryFile] = process.argv.slice(2);
const args = buildDockerRunArgs({ containerName, hostTmpDir, entryFile });
process.stdout.write(JSON.stringify(args));
TSEOF

docker_args_json() {
  # $1=containerName $2=hostTmpDir $3=entryFile
  (cd "$API_DIR" && "$TSX" "$ARGS_HELPER" "$1" "$2" "$3")
}

run_docker_json_args() {
  # Reads a JSON array of argv from $1 (file path) and execs `docker` with it.
  local args_file="$1"
  shift
  local -a argv=()
  while IFS= read -r tok; do argv+=("$tok"); done < <(jq -r '.[]' "$args_file")
  docker "${argv[@]+"${argv[@]}"}" "$@"
}

# ===========================================================================
# Proof 2b (done first, standalone): PID 1 itself runs as uid 0.
# Same buildDockerRunArgs, no --user flag -> the entrypoint script IS PID 1.
# ===========================================================================
section "Proof 2b: PID 1 (would-be harness) runs as in-container root"
PID1_DIR="$WORK/pid1"
mkdir -p "$PID1_DIR"
cat > "$PID1_DIR/whoami.js" <<'JSEOF'
process.stderr.write('pid1-debug uid=' + process.getuid() + ' gid=' + process.getgid() + '\n');
console.log(JSON.stringify({ pid1uid: process.getuid(), pid1gid: process.getgid() }));
JSEOF

PID1_CN="verdict-uidspike-pid1-$$"
ARGS_FILE="$WORK/args-pid1.json"
docker_args_json "$PID1_CN" "$PID1_DIR" "whoami.js" > "$ARGS_FILE"

if grep -q '"--user"' "$ARGS_FILE"; then
  fail "buildDockerRunArgs still emits --user (design requires it removed)"
fi

PID1_OUT="$(run_docker_json_args "$ARGS_FILE" 2>"$WORK/pid1.stderr")"
echo "  container stdout: $PID1_OUT"
echo "  container stderr: $(cat "$WORK/pid1.stderr")"
PID1UID="$(printf '%s' "$PID1_OUT" | jq -r '.pid1uid' 2>/dev/null)"
if [ "$PID1UID" = "0" ]; then
  pass "PID 1 runs as uid=0 (in-container root) — no --user flag present"
else
  fail "expected PID 1 uid=0, got '$PID1UID'"
fi
docker rm -f "$PID1_CN" >/dev/null 2>&1 || true

# ===========================================================================
# Main submission run: one hardened container via harness.js, covering
# proofs 1, 2a, 3, 4 as separate manifest cases (mirrors how a real
# multi-test-case submission is graded — one container, one harness, N cases,
# main.js branches on stdin input exactly like a real grading case does).
# ===========================================================================
section "Main run: hostile + id-check + correct + regression cases via harness.js"

SUB_DIR="$WORK/sub"
mkdir -p "$SUB_DIR"
cp "$HARNESS_SRC" "$SUB_DIR/harness.js"

cat > "$SUB_DIR/main.js" <<'JSEOF'
const fs = require('fs');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const mode = input.trim();
  if (mode === 'proc-inject') {
    try {
      fs.writeFileSync('/proc/1/fd/1', JSON.stringify({ submissionId: 'FORGED', results: [{ id: 'x', stdout: 'PWNED' }] }));
      console.log(JSON.stringify({ mode, wrote: true }));
    } catch (e) {
      console.log(JSON.stringify({ mode, wrote: false, code: e.code, message: e.message }));
    }
  } else if (mode === 'getuid') {
    console.log(JSON.stringify({ mode, uid: process.getuid(), gid: process.getgid() }));
  } else if (mode === 'correct') {
    console.log('42');
  } else if (mode === 'fs-write-work') {
    try {
      fs.writeFileSync('/work/pwned.txt', 'x');
      console.log(JSON.stringify({ mode, wrote: true }));
    } catch (e) {
      console.log(JSON.stringify({ mode, wrote: false, code: e.code }));
    }
  } else if (mode === 'net-attempt') {
    require('http')
      .get('http://93.184.216.34/', () => console.log(JSON.stringify({ mode, connected: true })))
      .on('error', (e) => console.log(JSON.stringify({ mode, connected: false, code: e.code })));
  } else {
    console.log(JSON.stringify({ mode: 'unknown', echo: mode }));
  }
});
JSEOF

cat > "$SUB_DIR/manifest.json" <<'JSONEOF'
{
  "submissionId": "uidspike-sub-1",
  "perCaseTimeoutMs": 5000,
  "maxCaseStdoutBytes": 8192,
  "maxCaseStderrBytes": 8192,
  "cases": [
    { "id": "proc-inject", "input": "proc-inject" },
    { "id": "getuid", "input": "getuid" },
    { "id": "correct", "input": "correct" },
    { "id": "fs-write-work", "input": "fs-write-work" },
    { "id": "net-attempt", "input": "net-attempt" }
  ]
}
JSONEOF

SUB_CN="verdict-uidspike-sub-$$"
ARGS_FILE_SUB="$WORK/args-sub.json"
docker_args_json "$SUB_CN" "$SUB_DIR" "harness.js" > "$ARGS_FILE_SUB"

RAW_STDOUT="$(run_docker_json_args "$ARGS_FILE_SUB" 2>"$WORK/sub.stderr")"
SUB_EXIT=$?
echo "  container exit code: $SUB_EXIT"
echo "  container stderr: $(cat "$WORK/sub.stderr" || true)"
echo "  raw harness stdout: $RAW_STDOUT"

if ! printf '%s' "$RAW_STDOUT" | jq -e . >/dev/null 2>&1; then
  fail "harness stdout is not valid JSON — result stream corrupted"
else
  RESULT_COUNT="$(printf '%s' "$RAW_STDOUT" | jq '.results | length')"
  SUBID="$(printf '%s' "$RAW_STDOUT" | jq -r '.submissionId')"
  if [ "$RESULT_COUNT" = "5" ] && [ "$SUBID" = "uidspike-sub-1" ]; then
    pass "harness result stream intact: submissionId correct, 5/5 case results present"
  else
    fail "harness result stream damaged: submissionId=$SUBID results=$RESULT_COUNT"
  fi

  # --- Proof 1: hostile /proc/1/fd/1 injection is rejected ---
  section "Proof 1: /proc/1/fd/1 self-injection"
  PROC_STDOUT="$(printf '%s' "$RAW_STDOUT" | jq -r '.results[] | select(.id=="proc-inject") | .stdout')"
  echo "  proc-inject case stdout: $PROC_STDOUT"
  PROC_CODE="$(printf '%s' "$PROC_STDOUT" | jq -r '.code' 2>/dev/null)"
  PROC_WROTE="$(printf '%s' "$PROC_STDOUT" | jq -r '.wrote' 2>/dev/null)"
  if [ "$PROC_WROTE" = "false" ] && { [ "$PROC_CODE" = "EACCES" ] || [ "$PROC_CODE" = "EPERM" ]; }; then
    pass "fs.writeFileSync('/proc/1/fd/1', ...) rejected with $PROC_CODE (submission cannot self-inject)"
  else
    fail "expected wrote=false + code EACCES/EPERM, got wrote=$PROC_WROTE code=$PROC_CODE"
  fi

  # --- Proof 2a: submission child runs at uid 65534 ---
  section "Proof 2a: submission child uid"
  GETUID_STDOUT="$(printf '%s' "$RAW_STDOUT" | jq -r '.results[] | select(.id=="getuid") | .stdout')"
  echo "  getuid case stdout: $GETUID_STDOUT"
  CHILD_UID="$(printf '%s' "$GETUID_STDOUT" | jq -r '.uid' 2>/dev/null)"
  if [ "$CHILD_UID" = "65534" ]; then
    pass "submission child process.getuid() === 65534 (distinct from PID 1's uid 0)"
  else
    fail "expected submission child uid 65534, got '$CHILD_UID'"
  fi

  # --- Proof 3: a correct solution still grades PASS through this path ---
  section "Proof 3: normal correct solution still PASSes"
  CORRECT_STDOUT="$(printf '%s' "$RAW_STDOUT" | jq -r '.results[] | select(.id=="correct") | .stdout')"
  CORRECT_EXIT="$(printf '%s' "$RAW_STDOUT" | jq -r '.results[] | select(.id=="correct") | .exitCode')"
  echo "  correct case stdout='$CORRECT_STDOUT' exitCode=$CORRECT_EXIT"
  if [ "$(printf '%s' "$CORRECT_STDOUT" | tr -d '[:space:]')" = "42" ] && [ "$CORRECT_EXIT" = "0" ]; then
    pass "correct solution: stdout matches expected ('42'), exitCode 0 -> would PASS host-side grading"
  else
    fail "correct-solution case did not behave as PASS (stdout='$CORRECT_STDOUT' exitCode=$CORRECT_EXIT)"
  fi

  # --- Proof 4: regression — /work write and outbound network still blocked ---
  section "Proof 4: regression — destructive classes still contained"
  FS_STDOUT="$(printf '%s' "$RAW_STDOUT" | jq -r '.results[] | select(.id=="fs-write-work") | .stdout')"
  echo "  fs-write-work case stdout: $FS_STDOUT"
  FS_WROTE="$(printf '%s' "$FS_STDOUT" | jq -r '.wrote' 2>/dev/null)"
  if [ "$FS_WROTE" = "false" ]; then
    pass "write to /work still blocked ($(printf '%s' "$FS_STDOUT" | jq -r '.code' 2>/dev/null))"
  else
    fail "write to /work was NOT blocked: $FS_STDOUT"
  fi

  NET_STDOUT="$(printf '%s' "$RAW_STDOUT" | jq -r '.results[] | select(.id=="net-attempt") | .stdout')"
  echo "  net-attempt case stdout: $NET_STDOUT"
  NET_CONNECTED="$(printf '%s' "$NET_STDOUT" | jq -r '.connected' 2>/dev/null)"
  if [ "$NET_CONNECTED" = "false" ]; then
    pass "outbound network attempt still blocked ($(printf '%s' "$NET_STDOUT" | jq -r '.code' 2>/dev/null))"
  else
    fail "outbound network attempt was NOT blocked: $NET_STDOUT"
  fi
fi

docker rm -f "$SUB_CN" >/dev/null 2>&1 || true

section "Summary"
leftover="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep verdict-uidspike || true)"
[ -z "$leftover" ] || { echo "  leftover containers: $leftover"; FAILURES=$((FAILURES + 1)); }

if [ "$FAILURES" -eq 0 ]; then
  echo "✓ ALL 4 UID-SEPARATION PROOFS HOLD"
  exit 0
else
  echo "✗ $FAILURES CHECK(S) FAILED"
  exit 1
fi
