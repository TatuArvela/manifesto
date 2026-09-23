# syntax=docker/dockerfile:1.7

# ── Builder stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo

# pnpm via corepack, pinned to whatever the workspace expects.
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
COPY packages/client/package.json packages/client/

# shared goes in whole, not just its manifest: its `prepare` script runs tsc
# during install, and tsc with no tsconfig.json prints its help and exits 1.
# That compile is also the shared build: the server imports its output
# (@manifesto/shared resolves to dist/index.js at runtime).
COPY packages/shared packages/shared

# Select the packages directly so shared's devDependencies (typescript) are
# installed too, since the builder compiles shared, not just server. The
# client comes along because the image serves it (see below); its test
# browser is never needed here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --filter @manifesto/server --filter @manifesto/shared \
  --filter @manifesto/client --frozen-lockfile

COPY packages/server packages/server

# The server build writes dist/VERSION with packages/build-version, which reads
# git history. The context has no `.git`, so a caller that knows the commit
# passes the resolved version in (image-publish.yml does); without it the image
# reports the release number from package.json.
COPY packages/build-version packages/build-version
ARG MANIFESTO_VERSION
RUN pnpm --filter @manifesto/server build

# The client, built to talk to the server that serves it: `/` is the
# same-origin form, so the page's stock `connect-src 'self'` reaches the API
# and both sockets and there is no CORS to set up. CLIENT_DIR below points the
# server at it; a deployment that hosts the client elsewhere can unset it.
COPY packages/client packages/client
RUN VITE_MANIFESTO_SERVER=/ pnpm --filter @manifesto/client build

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
    DATA_DIR=/app/data \
    CLIENT_DIR=/app/public

COPY --from=builder /prod/dist ./dist
COPY --from=builder /prod/package.json ./package.json
COPY --from=builder /prod/node_modules ./node_modules
COPY --from=builder /repo/packages/client/dist ./public

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
