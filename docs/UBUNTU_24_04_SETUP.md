# Ubuntu 24.04 Production Setup

This guide covers bootstrapping a production server (6 GB RAM / 4 vCPU / 60 GB SSD) to run the
platform, and performing the first deploy. Application images are always built in CI; the
server only ever pulls pre-built images.

## 1. Resource budget

| Service | Memory limit | vCPU limit | Notes |
| --- | --- | --- | --- |
| PostgreSQL 16 | 768 MB | 1.5 | `shared_buffers=512MB`, `max_connections=100` |
| Redis 7 | 320 MB | 0.5 | `maxmemory 256mb`, `allkeys-lru` eviction |
| NestJS API | 768 MB | 1.0 | Node heap capped at 512 MB; the rest covers native memory |
| Next.js web | 768 MB | 1.0 | `output: 'standalone'`, Node heap capped at 512 MB |
| Caddy | 128 MB | 0.5 | Automatic Let's Encrypt SSL, HTTP/3 |

These limits are enforced in `deploy/docker-compose.prod.yml`. A 4 GB swapfile, configured by
`server-init.sh`, absorbs short-lived spikes.

Builds are never run on the server: a `next build` or TypeScript compile can spike RAM well
past what a 6 GB host can spare alongside a live database. All images are built on GitHub
Actions runners and only pulled here (see `docs/CICD_GUIDE.md`).

## 2. Server bootstrap

`deploy/scripts/server-init.sh` is the bootstrap reference for a fresh server. Run it once,
as root or with `sudo`, after copying it to the server:

```bash
chmod +x server-init.sh
sudo bash server-init.sh
```

It performs:
1. APT updates and installs the base tooling (`curl`, `git`, `ufw`, `fail2ban`, etc.).
2. A 4 GB swapfile at `/swapfile` with `vm.swappiness=10`.
3. UFW firewall rules: allows SSH (22), HTTP (80) and HTTPS/HTTP3 (443 tcp+udp) only.
   PostgreSQL and Redis are never exposed to the host network - they run only on the
   Docker-internal network (`internal_net` in `docker-compose.prod.yml`).
4. Fail2ban for SSH brute-force protection.
5. Docker Engine and the Compose plugin from the official Docker APT repository.
6. Creates the deployment directories.

Do not edit `server-init.sh` from this guide; treat it as the source of truth and update the
script itself if its behavior needs to change.

## 3. DNS and TLS

Create two `A` records pointing at the server's IP, matching the domains you will put in
`.env` (`WEB_DOMAIN`, `API_DOMAIN`), for example:

| Type | Host | Purpose |
| --- | --- | --- |
| A | panel.example.com | Admin panel / booking pages |
| A | api.example.com | REST API |

Caddy (`deploy/caddy/Caddyfile`) requests and renews Let's Encrypt certificates automatically
once these domains resolve to the server - no manual certbot setup is needed.

## 4. Application directory and environment

The server-side application directory is `/opt/app` (created by `server-init.sh` and used by
`deploy/scripts/lib.sh` and the deploy workflow). Set it up once:

```bash
sudo mkdir -p /opt/app
sudo chown -R "$USER":"$USER" /opt/app
cd /opt/app
cp .env.example .env
nano .env
```

Fill in `.env` from the template at the repository root (`.env.example`): `IMAGE_REPO`,
`GIT_REMOTE` (only needed for `nightly-deploy.sh`), `WEB_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`,
`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET` (32+ characters, generate with
`openssl rand -hex 32`), and the SMS provider settings. Never commit this file.

## 5. First deploy

Once `/opt/app/.env` is filled in, the recommended path is to enable the deploy job in CI (see
`docs/CICD_GUIDE.md` for the `DEPLOY_ENABLED` variable and the SSH secrets it needs) and push
to `main`, or trigger `release.yml` manually with `workflow_dispatch`.

To deploy by hand instead - useful for the very first run, or when diagnosing an issue directly
on the server - copy `deploy/docker-compose.prod.yml`, `deploy/caddy/Caddyfile` and
`deploy/scripts/*.sh` into `/opt/app` and `/opt/app/caddy`, `/opt/app/scripts`, then run:

```bash
cd /opt/app
chmod +x scripts/*.sh
bash scripts/deploy.sh sha-<commit>
```

`sha-<commit>` must be a tag that CI has already built and pushed to `ghcr.io`. `deploy.sh`
pulls the images, runs database migrations, starts the stack, and runs a smoke test with
automatic rollback on failure. See `docs/CICD_GUIDE.md` section 4 for the full sequence.

## 6. Automated daily backups

Add a cron job for `deploy/scripts/backup.sh`, which `pg_dump`s the database, gzips it into
`/opt/app/backups/`, and rotates dumps older than 14 days:

```bash
sudo crontab -e
```

```cron
30 3 * * * /bin/bash /opt/app/scripts/backup.sh >> /opt/app/backups/cron.log 2>&1
```

An off-site copy to object storage is not yet implemented; see the backlog in `HANDOVER.md`
(section 6.1).
