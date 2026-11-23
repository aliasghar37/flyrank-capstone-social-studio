FROM node:24-alpine AS base

RUN apk add --no-cache postgresql-client libc6-compat
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @studio/shared build \
  && pnpm --filter @studio/api build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]
