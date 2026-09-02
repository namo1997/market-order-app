FROM node:24-alpine AS mobile-builder

WORKDIR /app/mobile-admin
COPY mobile-admin/package*.json ./
RUN npm ci
COPY mobile-admin ./
RUN npm run build

FROM node:24-alpine AS mobile-v2-builder

WORKDIR /app/mobile-admin-v2
COPY mobile-admin-v2/package*.json ./
RUN npm ci
COPY mobile-admin-v2 ./
RUN npm run build

FROM node:24-alpine AS mobile-v3-builder

WORKDIR /app/mobile-admin-v3
COPY mobile-admin-v3/package*.json ./
RUN npm ci
COPY mobile-admin-v3 ./
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src src
COPY public public
COPY scripts scripts
COPY --from=mobile-builder /app/mobile-admin/dist mobile-admin/dist
COPY --from=mobile-v2-builder /app/mobile-admin-v2/dist mobile-admin-v2/dist
COPY --from=mobile-v3-builder /app/mobile-admin-v3/dist mobile-admin-v3/dist

ENV NODE_ENV=production
ENV PORT=8000
ENV CAPTURE_DATA_DIR=/data

CMD ["node", "src/server.js"]
