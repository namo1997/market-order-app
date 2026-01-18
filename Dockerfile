FROM node:20-alpine

WORKDIR /app

COPY server/package*.json server/
COPY client/package*.json client/

RUN npm --prefix server install --omit=dev \
  && npm --prefix client install

COPY server server
COPY client client

ENV VITE_API_URL=/api

RUN npm --prefix client run build

ENV NODE_ENV=production
ENV SERVE_CLIENT=true

WORKDIR /app/server

CMD ["node", "src/server.js"]
