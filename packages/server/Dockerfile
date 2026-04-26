# syntax=docker/dockerfile:1.7

# ── Builder stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo

# pnpm via corepack — pinned to whatever the workspace expects.
RUN corepack enable

# Install build toolchain for better-sqlite3 / argon2 native bindings.
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first so the dep layer caches between source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

RUN pnpm install --filter ...@manifesto/server --frozen-lockfile

# Copy sources and build.
COPY packages/shared packages/shared
COPY packages/server packages/server
RUN pnpm --filter @manifesto/server build

# Trim devDependencies for the runtime image.
RUN pnpm install --filter ...@manifesto/server --prod --frozen-lockfile --ignore-scripts \
  && pnpm rebuild --filter @manifesto/server

# ── Runtime stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Run as a non-root user so a container escape doesn't write into /etc.
RUN addgroup -S manifesto && adduser -S manifesto -G manifesto

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data

COPY --from=builder /repo/packages/server/dist ./dist
COPY --from=builder /repo/packages/server/package.json ./package.json
COPY --from=builder /repo/packages/server/node_modules ./node_modules
COPY --from=builder /repo/packages/shared ./node_modules/@manifesto/shared

VOLUME ["/app/data"]
EXPOSE 3001

USER manifesto
CMD ["node", "dist/index.js"]
