# syntax=docker/dockerfile:1
# Multi-stage image for the NestJS API.
# No OS packages are installed: busybox wget covers the healthcheck and
# compose `init: true` provides PID 1 signal handling.

FROM node:25-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@9.15.4
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

# Self-contained production tree: prod dependencies only, workspace packages
# copied in, Prisma client generated against the copied schema.
RUN pnpm --filter @platform/api deploy --prod /out \
 && cd /out/node_modules/@platform/database \
 && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

FROM node:25-alpine AS runner
ENV NODE_ENV=production PORT=4000 NODE_OPTIONS=--max-old-space-size=512
WORKDIR /app
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/main.js"]
