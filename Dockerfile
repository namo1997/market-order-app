FROM node:20-alpine

WORKDIR /app

COPY server/package*.json server/
COPY client/package*.json client/

RUN npm --prefix server ci --omit=dev \
  && npm --prefix client ci

COPY server server
COPY client client

ENV VITE_API_URL=/api

RUN node --experimental-vm-modules --test server/tests/*.test.mjs \
  && npm --prefix client run build

ENV NODE_ENV=production
ENV SERVE_CLIENT=true

WORKDIR /app/server

CMD ["node", "src/server.js"]
