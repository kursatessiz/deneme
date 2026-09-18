# Pilates Studio OS - Project Guidelines & Standards

## Overview
Pilates Studio OS is a multi-tenant boutique studio management system built on a full TypeScript monorepo.
It powers multiple independent studios (e.g. Studio A and Studio B) with complete tenant data isolation, shared types, a centralized NestJS backend, Next.js 15 administrative and reception portal, and Expo mobile client.

## Core Monorepo Architecture
```
pilates-studio-os/
├── apps/
│   ├── api/             # NestJS 11 REST API + BullMQ Queues + WebSocket
│   ├── web/             # Next.js 15 (App Router, Tailwind CSS, Lucide Icons)
│   └── mobile/          # Expo React Native (Member & Trainer app)
├── packages/
│   ├── shared/          # TypeScript types, Zod schemas, constants, enums
│   ├── database/        # Prisma ORM schema, migrations, seeders
│   └── config/          # Shared ESLint, Prettier, and TS configurations
├── deploy/
│   ├── docker/          # Optimized production multi-stage Dockerfiles
│   ├── docker-compose.prod.yml # Production orchestration (Postgres, Redis, Caddy, Apps)
│   ├── caddy/           # Caddyfile (Automatic Let's Encrypt SSL, Reverse Proxy)
│   └── scripts/         # Server initialization, automated backups, rollback
└── .github/workflows/   # Agentic CI/CD Pipeline with self-healing smoke tests
```

## TypeScript & Code Quality Rules
1. **Strict TypeScript**: Always enable `strict: true` in `tsconfig.json`. No `any` types without explicit review and commentary.
2. **Single Source of Truth**: All shared models, validation schemas (Zod), and enums live in `packages/shared`. Never duplicate types in `web` or `api`.
3. **Multi-Tenancy Guard**:
   - Every database table containing tenant data must include `studioId: String @map("studio_id")`.
   - Every API request must pass through the `StudioTenantGuard` or `JwtAuthGuard`.
   - Never query tenant entities without filtering by `studioId` unless the user is explicitly authorized with `SUPER_ADMIN` role.
4. **Environment Isolation**:
   - Never hardcode secrets, API keys, or database URLs.
   - Use strongly-typed environment validation with Zod or `@nestjs/config`.

## Production & Resource Constraints (Ubuntu 24.04 - 6GB RAM)
- **Zero In-Server Builds**: Always build Docker images on GitHub Actions CI. The Ubuntu 24.04 host only pulls pre-built images (`ghcr.io/org/repo/api:tag`).
- **Resource Allocations**:
  - PostgreSQL 16: `shared_buffers = 512MB`, `max_connections = 100`
  - Redis 7: `maxmemory 256mb`, `maxmemory-policy allkeys-lru`
  - NestJS API: Node.js heap limit `--max-old-space-size=512`
  - Next.js Web: Node.js heap limit `--max-old-space-size=512`, `output: 'standalone'`
  - Caddy: Automatic SSL, HTTP/3, memory footprint < 100MB
- **Safety Buffers**: 4GB Swapfile configured on host for spike resilience.

## Git & Deployment Protocol
- Branch `main` deploys to Production automatically via GitHub Actions.
- Every deployment triggers an automated **Smoke Test** verifying:
  - Database connectivity
  - Redis queue connectivity
  - Web & API `/health` endpoints
- If smoke test fails 3 consecutive attempts, **automatic rollback** to previous release occurs immediately.
