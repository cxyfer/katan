# syntax=docker/dockerfile:1

# Node 24 is the LTS line with corepack still bundled; the runtime stage copies
# this exact binary, so builds and production always run the same Node. The
# floating tag picks up security releases on every rebuild.
ARG NODE_IMAGE=node:24-trixie-slim

# --- build ------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Dependency layer first so source edits do not re-resolve the lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/rules/package.json packages/rules/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm --filter @catan/web build \
 && pnpm --filter @catan/server build \
 && mkdir -p /rootfs/data

# --- runtime ----------------------------------------------------------------
# Distroless cc supplies glibc, libstdc++ and CA certificates but no shell or
# package manager. The server bundle has no native modules, so the Node binary
# is the only thing it needs; npm, corepack, yarn and headers stay behind.
FROM gcr.io/distroless/cc-debian13 AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SQLITE_PATH=/data/catan.sqlite
ENV WEB_DIST_PATH=/app/web
WORKDIR /app

COPY --from=builder /usr/local/bin/node /usr/local/bin/node
# The application is root-owned and read-only to the service; only /data is
# writable. UID 10001 is kept so existing volumes stay accessible.
COPY --from=builder --chown=10001:10001 /rootfs/data /data
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/web/dist ./web
COPY --from=builder /app/package.json ./package.json

USER 10001:10001
VOLUME ["/data"]
EXPOSE 3000

# Exec form: the image has no /bin/sh.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The service persists active games and closes connections on SIGTERM.
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.mjs"]
