# ---- Build stage: build all three unit apps from the pnpm workspace ----
FROM node:20-alpine AS builder
RUN npm install -g pnpm@9.15.0
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
# admin-shared has no build script (source-only); ignore if absent
RUN pnpm --filter @workspace/admin-shared build 2>/dev/null || true
RUN pnpm --filter @workspace/clinic-admin build
RUN pnpm --filter @workspace/arena-admin build
RUN pnpm --filter @workspace/gym-admin build

# ---- Runtime stage: gateway + the built dist folders ----
FROM node:20-alpine
WORKDIR /app
# dist folders placed next to server.js so resolveDist() finds ./<unit>-admin/dist
COPY --from=builder /app/artifacts/clinic-admin/dist ./clinic-admin/dist
COPY --from=builder /app/artifacts/arena-admin/dist ./arena-admin/dist
COPY --from=builder /app/artifacts/gym-admin/dist ./gym-admin/dist
COPY artifacts/admin-gateway/server.js ./server.js
COPY artifacts/admin-gateway/public ./public
COPY artifacts/admin-gateway/package.json ./package.json
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "server.js"]
