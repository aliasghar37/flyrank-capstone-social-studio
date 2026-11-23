FROM node:24-alpine AS base

RUN corepack enable && corepack prepare pnpm@11.11.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @studio/shared build \
  && pnpm --filter @studio/worker build

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/index.js"]
