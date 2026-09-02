# Multi-stage Dockerfile: compiles Rust VCS for target container architecture (SEC-026)
FROM rust:1.80-alpine3.19 AS vcs-builder
WORKDIR /vcs
RUN apk add --no-cache musl-dev
COPY vcs/Cargo.toml vcs/Cargo.lock ./
COPY vcs/src ./src
RUN cargo build --release

FROM node:20.18.1-alpine3.19 AS builder
WORKDIR /app
COPY server/package.json server/pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install
COPY server .
RUN npm run build

FROM node:20.18.1-alpine3.19
WORKDIR /app
RUN apk add --no-cache libgcc
COPY --from=vcs-builder /vcs/target/release/itehaas /usr/local/bin/itehaas
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
