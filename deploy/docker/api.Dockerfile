# ==========================================
# Multi-Stage Dockerfile for NestJS Core API
# ==========================================

# 1. Base image
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN npm install -g pnpm@9.15.4

# 2. Dependencies & Build
FROM base AS builder
WORKDIR /app

COPY pnpm-lock.yaml* package.json pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Generate Prisma Client
WORKDIR /app/packages/database
RUN npx prisma generate

# Build shared and API packages
WORKDIR /app
RUN pnpm turbo run build --filter=@pilates/api...

# 3. Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install OpenSSL for Prisma engine
RUN apk add --no-cache openssl wget dumb-init

# Non-root user for maximum security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json

USER nestjs

EXPOSE 4000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
