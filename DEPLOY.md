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

## What's free and what it's for

| Service | Role | Why this one |
|---|---|---|
| **Oracle Cloud "Always Free" VM** | Runs the API, the sandbox's Docker daemon, Postgres, and (simplest) the web app too | The only mainstream free tier that's a genuine VM with root/Docker access, has no 12-month expiry (unlike AWS/GCP free trials), and the Ampere A1 shape gives up to 4 OCPU / 24 GB RAM — plenty for Postgres + Node + `node:20-alpine` containers |
| **Caddy** (installed on the VM) | Reverse proxy + automatic HTTPS (Let's Encrypt) | Zero-config TLS, one binary, no separate cert-renewal cron |
| **sslip.io** (or your own domain) | DNS | Free wildcard DNS that resolves `<ip>.sslip.io` to the VM's IP — no domain purchase needed for a demo |
| **`MOCK_LLM=1`** (already the default) | AI feedback / doubt drafting | Keyless — you don't need an NVIDIA NIM account to have a fully working deployed demo. Swap in a real `LLM_API_KEY` later if you want live model output |

This keeps the deployment to **one box** and zero recurring cost. A split alternative (web on Vercel,
Postgres on Neon) is covered at the bottom, but it still needs this same VM for the API, so start here.

---

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

MOCK_LLM=1   # flip to 0 + set LLM_API_KEY once you have an NVIDIA NIM (or other OpenAI-compatible) key
```

Leave `API_PROXY_TARGET` pointed at `localhost` — the browser only ever talks to Caddy on 443, which
forwards to the Next.js app, which proxies `/api/*` to the NestJS app internally. This preserves the
same-origin cookie posture ADR-005 relies on (no CORS, no cross-site cookie issues).

> **Cookie note:** `apps/api/src/auth/cookie.ts` sets `secure: false` deliberately (see the comment there —
> it's a documented shared contract with the web slice, not an oversight). The cookie still works correctly
> once you're behind HTTPS; `secure:false` just means it *would also* work over plain HTTP. Nothing to change
> for this deployment, but don't put the API on a public HTTP-only endpoint without Caddy in front of it.

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
