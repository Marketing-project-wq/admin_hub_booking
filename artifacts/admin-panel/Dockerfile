FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY . .
RUN pnpm install --no-frozen-lockfile
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN pnpm --filter @workspace/admin-panel build
WORKDIR /app/artifacts/admin-panel
CMD ["pnpm", "start"]
