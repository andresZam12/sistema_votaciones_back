FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder --chown=node:node /app/dist ./dist
# Scripts Lua necesarios en runtime
COPY --chown=node:node src/redis/scripts ./dist/redis/scripts

USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]

