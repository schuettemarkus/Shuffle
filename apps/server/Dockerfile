# Shuffle game server — Colyseus + Express on Node 20.
# Runs TypeScript directly via tsx so we don't need a separate compile step
# for the workspace-linked @shuffle/shared package.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /app

# ---- Install deps (cached) ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter @shuffle/server... --filter @shuffle/shared

# ---- Runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY pnpm-workspace.yaml package.json ./
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared

# Fly binds to the port set in fly.toml's internal_port; we default to 2567
# locally but the platform overrides PORT.
EXPOSE 2567
WORKDIR /app/apps/server
CMD ["pnpm", "start"]
