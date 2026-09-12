# syntax=docker/dockerfile:1.7

# ── Builder stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo

# pnpm via corepack — pinned to whatever the workspace expects.
RUN corepack enable

# pnpm may prompt before removing a modules directory; a buildx step has no
# TTY, so tell pnpm it's running in CI to proceed non-interactively.
ENV CI=true

# Install build toolchain for better-sqlite3 / argon2 native bindings.
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first so the dep layer caches between server edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/server/package.json packages/server/

# shared goes in whole, not just its manifest: its `prepare` script runs tsc
# during install, and tsc with no tsconfig.json prints its help and exits 1.
# That compile is also the shared build — the server imports its output
# (@manifesto/shared resolves to dist/index.js at runtime).
COPY packages/shared packages/shared

# Select both packages directly so shared's devDependencies (typescript) are
# installed too — the builder compiles shared, not just server.
RUN pnpm install --filter @manifesto/server --filter @manifesto/shared --frozen-lockfile

COPY packages/server packages/server
RUN pnpm --filter @manifesto/server build

# Produce a self-contained production bundle. `pnpm deploy` writes a real,
# fully-resolved node_modules (no symlinks into the workspace .pnpm store) plus
# the package's own files, so the runtime stage can copy it verbatim.
RUN pnpm --filter @manifesto/server deploy --prod --legacy /prod

# ── Runtime stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Run as a non-root user so a container escape doesn't write into /etc.
RUN addgroup -S manifesto && adduser -S manifesto -G manifesto

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data

COPY --from=builder /prod/dist ./dist
COPY --from=builder /prod/package.json ./package.json
COPY --from=builder /prod/node_modules ./node_modules

# Create the data dir up front and hand it to the runtime user, so the SQLite
# driver can write even when /app/data is backed by an anonymous volume.
RUN mkdir -p /app/data && chown -R manifesto:manifesto /app/data

VOLUME ["/app/data"]
EXPOSE 3001

# Probe the public health endpoint so orchestrators (Compose, K8s, ECS) can
# tell the difference between "container started" and "HTTP listener up".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER manifesto
CMD ["node", "dist/index.js"]
