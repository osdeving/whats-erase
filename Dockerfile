FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps ./apps
RUN npm run build -w @whats-erase/web && npm run build -w @whats-erase/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @whats-erase/server

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
