# Controlled release: preserve compiled frontend from the current successful deployment.
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src src
COPY public public
COPY scripts scripts
COPY mobile-admin-v3/dist mobile-admin-v3/dist
ENV NODE_ENV=production
ENV PORT=8000
ENV CAPTURE_DATA_DIR=/data
CMD ["node", "src/server.js"]
