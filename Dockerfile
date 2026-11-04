FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
# Scripts Lua necesarios en runtime
COPY src/redis/scripts ./dist/redis/scripts

EXPOSE 3000

CMD ["node", "dist/server.js"]
