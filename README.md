[![CI](https://github.com/pro-emtia/deneme/actions/workflows/ci.yml/badge.svg)](https://github.com/pro-emtia/deneme/actions/workflows/ci.yml)
[![Repository](https://img.shields.io/badge/GitHub-pro--emtia%2Fdeneme-blue?logo=github)](https://github.com/pro-emtia/deneme)

# The platform

A multi-tenant SaaS platform for membership- and appointment-based businesses. The first
customers are two independent pilates/reformer studios, but the platform is not pilates
specific: it is meant to fit any business built around sessions, capacity-limited resources
and session- or credit-based pricing (personal training, physiotherapy, yoga, spa, martial
arts, swimming schools, tennis/padel courts, music and language courses, kids' activity
centers, coworking rooms). A permanent product name has not been chosen yet; this repository
and its docs refer to it as "the platform". See `HANDOVER.md` for the full product definition
and backlog.

## Monorepo layout

```
.
├── apps/
│   ├── api/                    # NestJS 11 REST API, BullMQ queues, WebSocket
│   ├── web/                    # Next.js 15 (App Router) admin panel and booking pages
│   └── mobile/                 # Expo (React Native) client - currently a skeleton
├── packages/
│   ├── shared/                 # Shared TypeScript types, Zod schemas, enums
│   └── database/               # Prisma schema, migrations, seed
├── deploy/
│   ├── docker/                 # Multi-stage production Dockerfiles
│   ├── docker-compose.prod.yml # Production compose stack
│   ├── docker-compose.dev.yml  # Local Postgres + Redis for development
│   ├── caddy/                  # Caddyfile (automatic Let's Encrypt SSL)
│   └── scripts/                # Server bootstrap, deploy, backup, rollback scripts
├── docs/
│   ├── UBUNTU_24_04_SETUP.md   # Server bootstrap and first deploy
│   ├── CICD_GUIDE.md           # CI/CD pipeline, secrets, agentic workflows
│   └── DATABASE_ERD.md         # Database schema overview
├── .github/workflows/          # CI, release, security and agentic workflows
├── CLAUDE.md                   # Development standards and architecture rules
└── turbo.json                  # Turborepo configuration
```

## Local development

Requirements: Node.js 20+ (22 recommended), pnpm, and Docker for local Postgres/Redis.

```bash
# 1. Install dependencies
pnpm install

# 2. Start local Postgres and Redis
docker compose -f deploy/docker-compose.dev.yml up -d

# 3. Configure the API environment
cp apps/api/.env.example apps/api/.env

# 4. Push the Prisma schema to the local database
pnpm --filter @platform/database exec prisma db push

# 5. Run every app in development mode
pnpm dev
```

- Web admin panel: http://localhost:3000
- API Swagger docs: http://localhost:4000/api/docs
- API health check: http://localhost:4000/health

## Common scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run all apps in development mode (Turborepo) |
| `pnpm build` | Build all apps and packages |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm test` | Run unit tests |
| `pnpm db:generate` | Generate the Prisma client |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed the database |

## Status

- `apps/web` renders from mock data and is not yet wired to the API.
- `apps/mobile` is a skeleton (single `App.tsx`), not a working client yet.
- Test coverage is low outside `apps/api` core modules.

See `HANDOVER.md` (backlog, section 6) for the planned work, including the schema revision
that will drop pilates-specific fields such as `SessionType` in favor of tenant-configurable
service types.

## Documentation

- Server bootstrap and first deploy: [`docs/UBUNTU_24_04_SETUP.md`](docs/UBUNTU_24_04_SETUP.md)
- CI/CD pipeline, secrets and agentic workflows: [`docs/CICD_GUIDE.md`](docs/CICD_GUIDE.md)
- Database schema overview: [`docs/DATABASE_ERD.md`](docs/DATABASE_ERD.md)
- Security policy and vulnerability reporting: [`SECURITY.md`](SECURITY.md)
