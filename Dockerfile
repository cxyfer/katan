# syntax=docker/dockerfile:1

# --- build ------------------------------------------------------------------
FROM node:22-slim AS builder
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
 && pnpm --filter @catan/server build

# --- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SQLITE_PATH=/data/catan.sqlite
ENV WEB_DIST_PATH=/app/web
WORKDIR /app

RUN groupadd --gid 10001 catan \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin catan \
 && mkdir -p /data \
 && chown -R catan:catan /data

COPY --from=builder --chown=catan:catan /app/packages/server/dist ./dist
COPY --from=builder --chown=catan:catan /app/packages/web/dist ./web
COPY --from=builder --chown=catan:catan /app/package.json ./package.json

USER 10001:10001
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The service persists active games and closes connections on SIGTERM.
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.mjs"]
