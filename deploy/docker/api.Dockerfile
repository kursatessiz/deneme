# syntax=docker/dockerfile:1
# Multi-stage image for the NestJS API.
# The only OS package is the PostgreSQL 16 client (pg_dump) for backups made
# from the super admin panel (docs/YEDEKLER.md); its major version matches
# the postgres:16.x-alpine server in docker-compose.prod.yml. busybox wget
# covers the healthcheck and compose `init: true` provides PID 1 signal
# handling.

# node:22.23.4-alpine (Node.js security release 2026-10-20), multi-arch index digest as of 2026-10-26 (Dependabot docker bumps it)
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app

FROM base AS builder
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @platform/api...

COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api
RUN pnpm --filter @platform/api... run build

# Self-contained production tree (--legacy: pnpm 10 otherwise needs
# inject-workspace-packages): prod dependencies only, workspace packages
# copied in, Prisma client generated against the copied schema.
RUN pnpm --filter @platform/api deploy --legacy --prod /out \
 && cd /out/node_modules/@platform/database \
 && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

# node:22.23.4-alpine (Node.js security release 2026-10-20), multi-arch index digest as of 2026-10-26 (Dependabot docker bumps it)
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runner
ENV NODE_ENV=production PORT=4000 NODE_OPTIONS=--max-old-space-size=512
RUN apk add --no-cache postgresql16-client
WORKDIR /app
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
# Source map store (H2): a named volume mounted here inherits this owner.
RUN mkdir -p /var/lib/app/sourcemaps && chown node:node /var/lib/app/sourcemaps
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/main.js"]
