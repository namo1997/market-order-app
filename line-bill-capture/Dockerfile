FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src src
COPY public public
COPY scripts scripts

ENV NODE_ENV=production
ENV PORT=8000
ENV CAPTURE_DATA_DIR=/data

CMD ["node", "src/server.js"]
