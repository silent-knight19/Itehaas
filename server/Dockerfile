# Multi-stage Dockerfile: compiles Rust VCS for target container architecture (SEC-026)
FROM rust:1.80-alpine3.19 AS vcs-builder
WORKDIR /workspace
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY vcs ./vcs
RUN cargo build --release -p itehaas

FROM node:20.18.1-alpine3.19 AS builder
WORKDIR /workspace
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
# S16/S17: strict frozen lockfile — never silently resolve fresh (unaudited) versions.
RUN corepack enable && pnpm install --frozen-lockfile
COPY server ./server
RUN cd server && npm run build
RUN pnpm --filter @itehaas/server --prod deploy /app

FROM node:20.18.1-alpine3.19
WORKDIR /app
RUN apk add --no-cache libgcc
COPY --from=vcs-builder /workspace/target/release/itehaas /usr/local/bin/itehaas
COPY --chown=node:node --from=builder /app ./
COPY database ./database
RUN mkdir -p /data/repos && chown -R node:node /data/repos && chmod 755 /data/repos
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
