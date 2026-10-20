# Node 22 LTS: server tests use node:sqlite, which is unflagged from 22.13 (absent in Node 20).
FROM node:22-alpine

WORKDIR /app

COPY server/package*.json server/
COPY client/package*.json client/

RUN npm --prefix server ci --omit=dev \
  && npm --prefix client ci

COPY server server
COPY client client
# Build-time only: server/tests/receiving-fix-m.test.mjs imports ../../pilot/app.mjs.
COPY pilot pilot

ENV VITE_API_URL=/api

RUN node --experimental-vm-modules --test server/tests/*.test.mjs \
  && npm --prefix client run build \
  && rm -rf pilot

ENV NODE_ENV=production
ENV SERVE_CLIENT=true

WORKDIR /app/server

CMD ["node", "src/server.js"]
