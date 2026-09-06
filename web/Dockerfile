FROM node:20.18.1-alpine3.19 AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# S16/S17: strict frozen lockfile — never silently resolve fresh (unaudited) versions.
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN npm run build

FROM node:20.18.1-alpine3.19
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.js ./next.config.js
USER node
EXPOSE 3000
CMD ["npm", "start"]
