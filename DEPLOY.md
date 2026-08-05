# Deploying verdict-desk (free-tier services)

## The constraint that shapes everything

Grading shells out to the **host's `docker` binary** (`spawn('docker', args)` in
`apps/api/src/sandbox/runner.service.ts`) to launch one locked-down container per submission — see
`README.md#1-the-grading-sandbox` and `DECISIONS.md` ADR-003. That means the API process needs:

- a real Docker Engine daemon running on the **same machine**, and
- its OS user in the `docker` group (or root),

which rules out ordinary serverless/PaaS "free web service" tiers. **Vercel, Render, Railway, Fly.io's
standard app runtime, Heroku, etc. do not expose a Docker socket or let you run a nested Docker daemon** —
deploying the API there will hard-fail on the first submission (`docker spawn error: ENOENT` or similar).
Containerizing the API itself and mounting `/var/run/docker.sock` is the alternative some guides suggest —
don't do that here; it's the privilege-escalation footgun ADR-003 explicitly avoids (a compromised sandboxed
payload would gain a path to the host's Docker socket).

So the API needs **a real VM with Docker Engine installed**, not a container platform. Everything below is
built around that.

> **Two paths in this document.** [**Google Cloud ($300 free trial)**](#google-cloud-300-trial--agent-executable-runbook)
> is written as a step-by-step runbook a coding agent can execute end to end, and is the recommended path if you
> have trial credit. The [Oracle Cloud Always Free](#alternative-oracle-cloud-always-free) path below it is the
> zero-expiry alternative. Both deploy the same single-box architecture.

## What's free and what it's for

| Service | Role | Why this one |
|---|---|---|
| **Google Cloud VM** ($300/90-day trial) | Runs the API, the sandbox's Docker daemon, Postgres, and the web app | Scriptable end to end via `gcloud` — the whole deploy is automatable, which is why the runbook below can be executed by an agent. `e2-medium` (2 vCPU / 4 GB) is ~$27/mo against $300 of credit. Expires after 90 days |
| **Oracle Cloud "Always Free" VM** | Same role, no expiry | The one mainstream tier that's a genuine VM with root/Docker access and **no** 12-month clock; Ampere A1 gives up to 4 OCPU / 24 GB. Provisioned by hand (its CLI story is worse) |
| **Caddy** (installed on the VM) | Reverse proxy + automatic HTTPS (Let's Encrypt) | Zero-config TLS, one binary, no separate cert-renewal cron |
| **sslip.io** (or your own domain) | DNS | Free wildcard DNS that resolves `<ip>.sslip.io` to the VM's IP — no domain purchase needed for a demo |
| **`MOCK_LLM=1`** (already the default) | AI feedback / doubt drafting | Keyless — you don't need an NVIDIA NIM account to have a fully working deployed demo. Swap in a real `LLM_API_KEY` later if you want live model output |

Either way the deployment is **one box**. A split alternative (web on Vercel, Postgres on Neon) is covered at
the bottom, but it still needs a VM for the API — and it gives up the same-origin posture that makes the
deploy require no code changes, so start with one box.

---

# Google Cloud ($300 trial) — agent-executable runbook

**Who this is written for.** A coding agent (Claude Code) with shell access on the developer's machine, driving
the deploy on the user's behalf. Every command is literal and copy-pasteable. Steps that *cannot* be automated
(browser sign-in, billing) are marked **USER STEP** — the agent must stop and ask, never fake them.

**Agent: read this whole section before running anything.** Work phase by phase and run each phase's
**Checkpoint** before continuing. If a checkpoint fails, fix it before proceeding — later phases assume it
passed.

## 0. What must change in the code for a new URL

**Nothing.** This is a property of the architecture, not luck, and it's worth stating up front because it's the
first thing you'd expect to have to change:

- The browser only ever talks to **one origin** (Caddy → Next.js). It calls the API with **relative** paths
  (`/api/*`), which the Next.js rewrite proxies internally. There are no absolute URLs in the frontend.
- That rewrite target is `API_PROXY_TARGET`, and on a single box it stays **`http://localhost:4000`** — it is
  server-to-server *inside* the VM and has nothing to do with the public hostname. Do not set it to your public
  URL; that would send traffic out to the internet and back.
- There is **no CORS configuration** anywhere in the API (`main.ts` never calls `enableCors`) — and none is
  needed, because same-origin means no cross-origin request ever happens.
- Auth is a same-origin `httpOnly` cookie, so no domain/`sameSite` change is needed either.

The one thing that **must** change for a public HTTPS deployment is a single env var:

| Var | Local | Deployed | Why |
|---|---|---|---|
| `COOKIE_SECURE` | `0` | **`1`** | Sends the auth cookie only over TLS (`apps/api/src/auth/cookie.ts` reads it at call time — no rebuild needed) |
| `JWT_SECRET` | dev default | **a real secret** | The committed default is public |
| `POSTGRES_PASSWORD` + `DATABASE_URL` | `verdict` | **a real password** | Must match each other |
| `MOCK_LLM` | `1` | `1` (or `0` + a key) | Keyless demo works as-is |

If you later split the web app onto a different origin than the API (e.g. Vercel), *then* CORS and cookie
attributes become real work — see [the split alternative](#alternative-splitting-webdb-onto-managed-free-tiers).
Don't do that for a demo.

## 1. Preconditions

**USER STEP 1 — claim the trial.** Sign up at [cloud.google.com/free](https://cloud.google.com/free) with a
Google account and a card (identity check; the $300/90-day credit is not auto-billed — the account stays in
trial until you explicitly upgrade). Skip if already done.

**Agent — install the CLI** (`gcloud` was not present on this machine at the time of writing):

```bash
brew install --cask gcloud-cli   # if that name 404s on an older Homebrew: brew install --cask google-cloud-sdk
gcloud version
```

**USER STEP 2 — sign in.** This opens a browser and cannot be automated. Ask the user to run it in the session
with a leading `!`:

```
! gcloud auth login
```

**Checkpoint 1** — all three must succeed:

```bash
gcloud version >/dev/null && echo "cli ok"
gcloud auth list --filter=status:ACTIVE --format='value(account)'   # must print an email
gcloud billing accounts list --format='value(name,displayName,open)' # must list an OPEN account
```

If the billing list is empty, the trial isn't active yet — stop and tell the user; nothing below will work.

## 2. Variables

Set these once per shell. Every later command references them, so re-export after any shell restart.

```bash
# --- identity (fill BILLING from Checkpoint 1's output: XXXXXX-XXXXXX-XXXXXX) ---
export BILLING="XXXXXX-XXXXXX-XXXXXX"
export PROJECT="verdict-desk-$(date +%s | tail -c 6)"   # must be globally unique
export ZONE="us-central1-a"                              # pick one near the evaluator
export REGION="${ZONE%-*}"

# --- machine ---
export VM="verdict-desk"
export MACHINE="e2-medium"        # 2 vCPU / 4 GB — Postgres + Node + sandbox containers
export DISK="30GB"

# --- app secrets (generated, not guessed) ---
export PG_PASSWORD="$(openssl rand -hex 16)"
export JWT_SECRET="$(openssl rand -hex 32)"
echo "SAVE THESE — pg:$PG_PASSWORD jwt:$JWT_SECRET"
```

> **Cost sanity.** `e2-medium` is roughly **$25–30/month** — about 8–10% of the $300 credit if left running for
> a month. A demo that runs for a few days costs a few dollars. `make abuse` and grading spin up short-lived
> containers on this same VM; no extra cost. See [§10](#10-cost-control-and-teardown) before you walk away.

## 3. Project, billing, APIs

```bash
gcloud projects create "$PROJECT" --name="verdict-desk"
gcloud billing projects link "$PROJECT" --billing-account="$BILLING"
gcloud config set project "$PROJECT"
gcloud config set compute/zone "$ZONE"
gcloud services enable compute.googleapis.com
```

**Checkpoint 2** — billing must be enabled, or instance creation fails with a confusing quota error:

```bash
gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)'   # must print True
gcloud services list --enabled --filter=compute --format='value(config.name)'  # must list compute.googleapis.com
```

## 4. Static IP, VM, firewall

Reserve the IP **before** creating the VM. An ephemeral IP changes whenever the instance stops, which would
break both the `sslip.io` hostname and the TLS certificate issued for it.

```bash
gcloud compute addresses create "${VM}-ip" --region="$REGION"
export VM_IP="$(gcloud compute addresses describe "${VM}-ip" --region="$REGION" --format='value(address)')"
echo "static IP: $VM_IP"

gcloud compute instances create "$VM" \
  --zone="$ZONE" \
  --machine-type="$MACHINE" \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size="$DISK" \
  --boot-disk-type=pd-balanced \
  --address="$VM_IP" \
  --tags=verdict-web

gcloud compute firewall-rules create verdict-allow-web \
  --allow=tcp:80,tcp:443 \
  --target-tags=verdict-web \
  --source-ranges=0.0.0.0/0 \
  --description="HTTP/HTTPS to the verdict-desk box (Caddy)"
```

The public hostname follows from the IP — `sslip.io` resolves `1-2-3-4.sslip.io` to `1.2.3.4` with no DNS setup:

```bash
export HOSTNAME_PUBLIC="$(echo "$VM_IP" | tr '.' '-').sslip.io"
echo "app will be at: https://$HOSTNAME_PUBLIC"
```

**Checkpoint 3** — SSH must work non-interactively. The **first** `gcloud compute ssh` generates a keypair and
would normally prompt for a passphrase; `--quiet` accepts the defaults (empty passphrase) and is what makes
every later remote command automatable. Run this exact command first:

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='echo ssh-ok && lsb_release -ds'
```

## 5. Provision the box

Quoting a long remote script through `--command` is where these runbooks usually break. Write the script
locally and copy it up instead — it stays readable and re-runnable.

```bash
cat > /tmp/provision.sh <<'PROVISION'
#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg git

# Swap: `next build` peaks well above what 4 GB leaves free, and the OOM killer
# takes out the build with a misleading error. 2 GB of swap avoids it.
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Docker Engine — the grading sandbox depends on it (ADR-003).
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# Node 20 (matches .nvmrc) + pnpm 9.
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm install -g pnpm@9 pm2

# Pre-pull the sandbox image so the first submission isn't a 30s cold pull.
sudo docker pull node:20-alpine
echo "PROVISION OK: $(node -v) / pnpm $(pnpm -v) / $(sudo docker --version)"
PROVISION

gcloud compute scp /tmp/provision.sh "$VM":~/provision.sh --zone="$ZONE" --quiet
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='bash ~/provision.sh'
```

**Checkpoint 4** — Docker must work **without sudo**, because the API shells out to it as the login user. The
`usermod` above only takes effect in a *new* session, which the next SSH connection provides:

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='docker run --rm hello-world >/dev/null && echo "docker ok (no sudo)"'
```

If that fails with a permissions error, the group hasn't applied — reconnect once more, or
`gcloud compute instances reset "$VM" --zone="$ZONE"` and retry.

## 6. Deploy the app

Get the code onto the box. Public repo:

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet \
  --command='git clone https://github.com/ishanavasthi/verdict-desk.git ~/verdict-desk || (cd ~/verdict-desk && git pull)'
```

Private repo (no credentials on the VM — ship the working tree instead):

```bash
git archive --format=tar.gz -o /tmp/verdict-desk.tgz HEAD
gcloud compute scp /tmp/verdict-desk.tgz "$VM":~/ --zone="$ZONE" --quiet
gcloud compute ssh "$VM" --zone="$ZONE" --quiet \
  --command='mkdir -p ~/verdict-desk && tar xzf ~/verdict-desk.tgz -C ~/verdict-desk'
```

Write the production `.env` on the VM. Note `API_PROXY_TARGET` stays on localhost (see [§0](#0-what-must-change-in-the-code-for-a-new-url)) and `COOKIE_SECURE=1` because Caddy terminates TLS:

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command="cat > ~/verdict-desk/.env <<ENVFILE
POSTGRES_USER=verdict
POSTGRES_PASSWORD=$PG_PASSWORD
POSTGRES_DB=verdict
POSTGRES_PORT=5432

DATABASE_URL=\"postgresql://verdict:$PG_PASSWORD@localhost:5432/verdict?schema=public\"
API_PORT=4000
JWT_SECRET=\"$JWT_SECRET\"
COOKIE_SECURE=1

WEB_PORT=3000
API_PROXY_TARGET=\"http://localhost:4000\"

MOCK_LLM=1
LLM_BASE_URL=\"https://integrate.api.nvidia.com/v1\"
LLM_API_KEY=\"\"
LLM_MODEL=\"meta/llama-3.1-8b-instruct\"
ENVFILE
echo '.env written'"
```

Install, migrate, seed, build. **`migrate deploy`, never `db push`** — `db push` skips the raw-SQL migration
that installs the answer-state-machine triggers (ADR-006), silently removing the project's core guarantee:

```bash
cat > /tmp/appsetup.sh <<'APPSETUP'
#!/usr/bin/env bash
set -euo pipefail
cd ~/verdict-desk

pnpm install --frozen-lockfile
pnpm --filter @verdict/api prisma:generate
docker compose up -d --wait db
pnpm --filter @verdict/api prisma:deploy    # runs the trigger migration
pnpm --filter @verdict/api seed
pnpm build                                   # nest build + next build
echo "APP SETUP OK"
APPSETUP

gcloud compute scp /tmp/appsetup.sh "$VM":~/appsetup.sh --zone="$ZONE" --quiet
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='bash ~/appsetup.sh'
```

Start both processes under pm2. The `set -a; source .env; set +a` is load-bearing: `next start` reads
`API_PROXY_TARGET` from the environment at boot, and the API needs `DATABASE_URL`/`JWT_SECRET`/`COOKIE_SECURE`:

```bash
cat > /tmp/appstart.sh <<'APPSTART'
#!/usr/bin/env bash
set -euo pipefail
cd ~/verdict-desk
set -a; source .env; set +a

pm2 delete verdict-api verdict-web 2>/dev/null || true
pm2 start "pnpm exec dotenv -e ../../.env -- node dist/main.js" \
  --name verdict-api --cwd ~/verdict-desk/apps/api --update-env
pm2 start "pnpm start" --name verdict-web --cwd ~/verdict-desk/apps/web --update-env
pm2 save

for i in $(seq 1 60); do curl -sf http://localhost:4000/health >/dev/null && break; sleep 2; done
curl -s http://localhost:4000/health; echo
curl -sf -o /dev/null -w 'web:%{http_code}\n' http://localhost:3000/login
APPSTART

gcloud compute scp /tmp/appstart.sh "$VM":~/appstart.sh --zone="$ZONE" --quiet
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='bash ~/appstart.sh'

# Survive a reboot: run the systemd command pm2 prints.
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='pm2 startup systemd -u $USER --hp /home/$USER | tail -1 | bash'
```

**Checkpoint 5** — the previous command must print `{"status":"ok","db":"up",...}` and `web:200`. If the API is
unhealthy, read the logs before continuing:
`gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='pm2 logs verdict-api --lines 50 --nostream'`.

## 7. TLS with Caddy

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y caddy'

gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command="printf '%s {\n    reverse_proxy localhost:3000\n}\n' '$HOSTNAME_PUBLIC' | sudo tee /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy"
```

Caddy requests a Let's Encrypt certificate on the first request; give it ~30 seconds.

**Checkpoint 6** — end to end over the public URL:

```bash
curl -sS "https://$HOSTNAME_PUBLIC/api/health"; echo
curl -sS -o /dev/null -w 'login page: %{http_code}\n' "https://$HOSTNAME_PUBLIC/login"
```

> **If certificate issuance fails**, it is almost always Let's Encrypt rate limiting on `sslip.io` (a shared
> domain on the Public Suffix List — heavily used). Two ways out: point a domain you own at `$VM_IP` with an
> `A` record and use that hostname instead, or, for a throwaway demo, replace the Caddyfile body with
> `tls internal` (self-signed — browsers will warn). Check what actually happened with
> `sudo journalctl -u caddy -n 50 --no-pager`.

## 8. Verify the deployment like an evaluator

```bash
echo "open https://$HOSTNAME_PUBLIC — log in with the buttons on the login page (password: password)"
```

Then walk the real flows in a browser:

1. **Grade** — as `student@verdict.dev`, open *Sum of Two Numbers*, submit a solution, confirm per-test results,
   a weighted score, hidden cases showing pass/fail only, and the "AI-generated · UNREVIEWED" card.
2. **Doubt → review** — post a doubt; you land on the doubt page and see the draft arrive as *awaiting review*
   with its text withheld. As `teacher@verdict.dev`, approve it in the review queue; the student's page updates.
3. **Visibility** — as `student2@verdict.dev`, confirm a non-approved answer is invisible entirely.
4. **The DB really enforces it** — an illegal transition must be rejected by Postgres, not by the app:

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='cd ~/verdict-desk && docker compose exec -T db psql -U verdict -d verdict -c "UPDATE answers SET state='"'"'APPROVED'"'"' WHERE state='"'"'REJECTED'"'"';"'
```

5. **The sandbox holds on this box** — this is the evidence artifact, and it must run *on the VM* (it needs the
   local Docker daemon and the running stack):

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='cd ~/verdict-desk && bash scripts/abuse-demo.sh'
```

All seven containment assertions should pass, proving the hardening flags are in effect in the deployed
environment and not just locally.

## 9. Updating a running deployment

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command='
  cd ~/verdict-desk && git pull && pnpm install --frozen-lockfile &&
  pnpm --filter @verdict/api prisma:deploy && pnpm build &&
  set -a && source .env && set +a && pm2 restart verdict-api verdict-web --update-env'
```

## 10. Cost control and teardown

The credit is finite and the VM bills while it runs, whether or not anyone is looking at it.

```bash
# Pause between demos (keeps the disk, the data, and the static IP)
gcloud compute instances stop "$VM" --zone="$ZONE"
gcloud compute instances start "$VM" --zone="$ZONE"   # same IP, so the URL and cert still work

# Done for good — delete the project and everything in it
gcloud projects delete "$PROJECT"
```

> A **stopped instance still bills for its disk and its reserved static IP** (cents/day, but not zero). Delete
> the project when the demo is over. Also set a budget alert at ~$50 in
> *Billing → Budgets & alerts* so a forgotten VM can't quietly drain the credit.

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `gcloud compute ssh` hangs or asks for a passphrase | First-run key generation | Re-run with `--quiet` (see Checkpoint 3) |
| `docker: permission denied` on the VM | `usermod -aG docker` needs a fresh session | Reconnect; or `gcloud compute instances reset` |
| `next build` killed | 4 GB RAM without swap | The swap step in §5 — verify with `free -h` |
| Submissions all `ERROR` | Sandbox image missing, or Docker not usable by the app user | `docker pull node:20-alpine`; re-check Checkpoint 4; `pm2 logs verdict-api` |
| Login succeeds but every page bounces to `/login` | `COOKIE_SECURE=1` while browsing over plain **http://** | Use the `https://` URL — that's the flag working as intended |
| `/api/health` 502s through Caddy | Web or API process down | `pm2 status`, then `pm2 logs` |
| Cert never issues | Let's Encrypt rate limit on `sslip.io` | See the note in §7 |
| Answers approve fine but illegal SQL transitions succeed | Schema created with `db push` | Re-create the DB and run `prisma:deploy` — the triggers live in a raw-SQL migration |

---

# Alternative: Oracle Cloud (Always Free)

Zero-expiry alternative to the GCP trial — the same single-box architecture, provisioned by hand.

## 1. Provision the VM

1. Sign up at [cloud.oracle.com/free](https://www.oracle.com/cloud/free/) (a card is required for identity
   verification; the Always Free resources are not billed as long as you stay within the free-tier shape).
2. Create a compute instance:
   - **Image:** Ubuntu 22.04 (Canonical, aarch64 if you picked an Ampere shape)
   - **Shape:** `VM.Standard.A1.Flex` — Always Free, up to 4 OCPU / 24 GB RAM. If Ampere capacity is
     exhausted in your region (a known Oracle Free Tier annoyance), retry in a few minutes/hours, try a
     different Availability Domain, or fall back to the `VM.Standard.E2.1.Micro` AMD shape (1 GB RAM — tight
     but workable if you skip running the web app on the same box).
   - **Networking:** create/attach a VCN with a public IP, and add ingress rules for **22 (SSH), 80, 443** in
     both the VCN's Security List *and* (Ubuntu ships `iptables`/`ufw` rules that also block by default —
     confirm with `sudo ufw status` once connected).
3. SSH in: `ssh ubuntu@<public-ip>`.

## 2. Base setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Docker Engine (official repo, not the snap package)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker   # or log out/in — picks up the docker group without a fresh SSH session

# Node 20 + pnpm (matches .nvmrc / engines.node)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm@9

# Confirm
docker run --rm hello-world
node -v && pnpm -v
```

## 3. Get the app and configure it

```bash
git clone <your-fork-or-repo-url> verdict-desk
cd verdict-desk
pnpm install
cp .env.example .env
```

Edit `.env` for production:

```bash
# Generate a real secret — never ship the dev default:
JWT_SECRET=$(openssl rand -hex 32)

DATABASE_URL="postgresql://verdict:<strong-password>@localhost:5432/verdict?schema=public"
POSTGRES_PASSWORD=<strong-password>   # match the line above

API_PORT=4000
WEB_PORT=3000
API_PROXY_TARGET="http://localhost:4000"   # api and web are on the same box — keep this internal
COOKIE_SECURE=1   # you're behind HTTPS (Caddy) — see the cookie note below

MOCK_LLM=1   # flip to 0 + set LLM_API_KEY once you have an NVIDIA NIM (or other OpenAI-compatible) key
```

Leave `API_PROXY_TARGET` pointed at `localhost` — the browser only ever talks to Caddy on 443, which
forwards to the Next.js app, which proxies `/api/*` to the NestJS app internally. This preserves the
same-origin cookie posture ADR-005 relies on (no CORS, no cross-site cookie issues).

> **Cookie note:** set `COOKIE_SECURE=1` in `.env` for any HTTPS deployment. `apps/api/src/auth/cookie.ts`
> reads it at call time (no rebuild needed) and the auth cookie is then only ever sent over TLS. It defaults to
> `0` so local dev over plain HTTP works. If you set it, browse the `https://` URL — over plain HTTP the browser
> won't send the cookie back and every page will bounce to `/login`.

## 4. Bring up Postgres, migrate, seed

```bash
make setup      # pnpm install (already done above) + prisma generate + pre-pulls node:20-alpine
make db-up      # docker compose up -d --wait db
make migrate    # prisma migrate deploy — runs the raw-SQL trigger migration, NEVER db push
make seed       # idempotent; creates student@verdict.dev / teacher@verdict.dev (password: password)
```

If this is a real (non-demo) deployment, change or remove the seeded demo accounts after confirming the app
works — they're intentionally well-known credentials for grading/demo purposes.

## 5. Build and run the app processes

```bash
pnpm build   # builds both apps/api (nest build) and apps/web (next build)
sudo npm install -g pm2
```

`pm2` (rather than raw systemd units) keeps this short and gives you `pm2 logs` / `pm2 restart` for free:

```bash
cd ~/verdict-desk
pm2 start apps/api/dist/main.js --name verdict-api \
  --cwd apps/api \
  --update-env
pm2 start "pnpm start" --name verdict-web --cwd apps/web
pm2 save
pm2 startup   # prints a systemd command — run the one it prints so pm2 survives reboots
```

`pm2 start apps/api/dist/main.js` runs with the shell's exported env, so either `export` the `.env` vars
first (`set -a; source .env; set +a`) or pass `--env-file` via a small wrapper — the important ones at
runtime are `API_PORT`, `DATABASE_URL`, `JWT_SECRET`, `MOCK_LLM`/`LLM_*`. `apps/web` reads `WEB_PORT` and
`API_PROXY_TARGET` the same way at boot.

Verify both processes locally on the box before wiring up the proxy:

```bash
curl localhost:4000/health   # {"status":"ok","db":"up",...}
curl -I localhost:3000       # 200
```

## 6. TLS + reverse proxy (Caddy)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Find your VM's public IP (`curl ifconfig.me`), then write `/etc/caddy/Caddyfile` — using `sslip.io` needs no
DNS setup at all (`<ip-with-dashes>.sslip.io` resolves to that IP automatically):

```
203-0-113-10.sslip.io {
    reverse_proxy localhost:3000
}
```

Replace `203-0-113-10` with your actual IP, dashes instead of dots. If you own a real domain, point an `A`
record at the VM's IP and use that hostname instead.

```bash
sudo systemctl reload caddy
```

Caddy requests and renews the Let's Encrypt cert automatically on first request — open
`https://<your-host>` in a browser and you should land on the app over HTTPS with no manual cert steps.

## 7. Smoke test

Mirror the README's "what you can try" against the live URL:

```bash
curl -s https://<your-host>/api/health | jq
```

Then in a browser: log in as `student@verdict.dev` / `password`, submit a solution, confirm you get
per-test results and an "AI-generated · UNREVIEWED" feedback card. Log in as `teacher@verdict.dev` and check
the review queue. Finally, run the sandbox abuse suite **on the VM itself** (it needs local Docker + the app
up):

```bash
cd ~/verdict-desk
bash scripts/abuse-demo.sh
```

All seven containment checks should pass — this is your evidence the sandbox flags (`--network none`,
`--pids-limit`, `--read-only`, etc.) are actually in effect in the deployed environment, not just locally.

## 8. Updating a running deployment

```bash
cd ~/verdict-desk
git pull
pnpm install
make migrate        # safe/no-op if there's nothing new to migrate
pnpm build
pm2 restart verdict-api verdict-web
```

## 9. Backups

The Postgres data lives in the `verdict-pgdata` Docker volume (see `docker-compose.yml`). A minimal cron
backup:

```bash
( crontab -l 2>/dev/null; echo "0 3 * * * cd ~/verdict-desk && docker compose exec -T db pg_dump -U verdict verdict | gzip > ~/backups/verdict-\$(date +\%F).sql.gz" ) | crontab -
mkdir -p ~/backups
```

---

## Alternative: splitting web/DB onto managed free tiers

If you'd rather not run the web app or Postgres on the VM (e.g. you want Vercel's preview deployments, or a
managed Postgres with its own backups/dashboard), you can split the stack — **the API still needs the VM**
from steps 1–2 above, Docker access is non-negotiable for it.

- **Web → Vercel (free Hobby tier):** `vercel deploy` from `apps/web`. Set `API_PROXY_TARGET` in Vercel's
  project env vars to `https://<your-vm-host>` (the HTTPS endpoint from step 6, fronting the API directly
  instead of the web app — put Caddy in front of port 4000 on a second (sub)domain, or a second `reverse_proxy
  localhost:4000` block in the same Caddyfile on a path/host). Next.js rewrites work fine proxying to an
  external origin, and because Vercel's server does the proxying, `Set-Cookie` from the API still lands on
  the Vercel domain — the same-origin cookie model from ADR-005 is preserved.
- **Postgres → Neon or Supabase (free tier):** skip `make db-up`/the local `docker compose` Postgres
  entirely; point `DATABASE_URL` at the managed instance's connection string, then `make migrate && make
  seed` from the VM (or anywhere with network access to it and the repo checked out, since migrations don't
  need Docker).
- **API → stays on the Oracle VM**, running just `verdict-api` under pm2/Caddy as above (steps 1, 2, part of
  3–5). You can drop the web-app pm2 process and the Caddy block for port 3000 if it's not serving anything
  locally anymore.

This trades one moving piece (the VM hosting everything) for three, in exchange for Vercel's edge network
for the frontend and a managed Postgres with point-in-time restore. For a 24h/demo-scale deployment, the
single-VM path above is less to operate and equally free.

## What doesn't work (and why, so you don't lose time on it)

- **Render / Railway / Fly.io "web service" free tiers for the API** — no Docker socket, no privileged
  containers, no way to `spawn('docker', ...)` against anything. The API will boot but every submission will
  fail at the grading step.
- **Containerizing the API and mounting `/var/run/docker.sock`** — technically makes `docker` reachable, but
  hands a compromised sandbox payload (or any RCE in the API) a direct path to full host control. ADR-003
  rejects this by design; don't reintroduce it to make a PaaS deploy easier.
- **`prisma db push` for the initial schema on a fresh managed Postgres** — always use `migrate deploy`
  (`make migrate`); `db push` silently skips the raw-SQL trigger migration that enforces the answer state
  machine (ADR-006), which defeats the assignment's core requirement.
