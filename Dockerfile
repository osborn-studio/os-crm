FROM node:24-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @partneros/database generate && pnpm build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
# A fresh production install avoids carrying the builder's development dependency tree.
RUN pnpm install --prod --frozen-lockfile && pnpm --filter @partneros/database generate && touch .env
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
RUN chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=127.0.0.1 WEB_HOST=0.0.0.0 PORT=4000 WEB_PORT=3000
EXPOSE 3000
CMD ["node", "deploy/container-start.mjs"]
