#!/bin/zsh
set -euo pipefail

APP_DIR="/Users/surachart/ระบบสั่งของตลาดสด"
LOCK_DIR="/tmp/solao-railway-sync.lock"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
PM2_BIN="${PM2_BIN:-/opt/homebrew/bin/pm2}"
SERVER_NAME="${SERVER_NAME:-market-order-server}"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[Railway Sync] another sync is already running"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

cd "$APP_DIR"

echo "[Railway Sync] stopping backend: $SERVER_NAME"
"$PM2_BIN" stop "$SERVER_NAME" || true

echo "[Railway Sync] syncing Railway -> local MySQL"
"$NODE_BIN" server/scripts/sync-railway-local.mjs

echo "[Railway Sync] restarting backend: $SERVER_NAME"
"$PM2_BIN" restart "$SERVER_NAME" --update-env || "$PM2_BIN" start server/src/server.js --name "$SERVER_NAME"

echo "[Railway Sync] completed"
