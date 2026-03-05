#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# start.sh  –  One-click launcher for ClickHouse Explorer
# Usage:  bash start.sh
# ──────────────────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"

echo ""
echo "  🚀  ClickHouse Explorer – Startup Script"
echo "  ─────────────────────────────────────────"

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "  ❌  Docker is required. Install from https://docker.com"
  exit 1
fi

# Check Node
if ! command -v node &>/dev/null; then
  echo "  ❌  Node.js is required. Install from https://nodejs.org"
  exit 1
fi

echo ""
echo "  📦  Starting ClickHouse via Docker…"
cd "$ROOT"
docker compose up -d clickhouse

echo "  ⏳  Waiting for ClickHouse to be ready…"
RETRIES=0
MAX_RETRIES=30
until docker exec clickhouse-explorer wget -qO- 'http://localhost:8123/?query=SELECT+1' 2>/dev/null | grep -q 1; do
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    echo "  ❌  ClickHouse failed to start after ${MAX_RETRIES}s. Check: docker logs clickhouse-explorer"
    exit 1
  fi
  sleep 1
done
echo "  ✅  ClickHouse is ready!"

echo ""
echo "  📦  Installing backend dependencies…"
cd "$BACKEND"
npm install --silent

echo ""
echo "  🌱  Seeding demo data (one-time, ~30s)…"
CLICKHOUSE_HOST=localhost CLICKHOUSE_PORT=8123 CLICKHOUSE_DB=demo node seed.js

echo ""
echo "  🔌  Starting backend API on http://localhost:3001 …"
CLICKHOUSE_HOST=localhost CLICKHOUSE_PORT=8123 CLICKHOUSE_DB=demo node server.js &
BACKEND_PID=$!
sleep 2

echo ""
echo "  🌐  Opening the Explorer in your browser…"
open "$ROOT/frontend/index.html" 2>/dev/null || xdg-open "$ROOT/frontend/index.html" 2>/dev/null || echo "  ➡️  Open: $ROOT/frontend/index.html"

echo ""
echo "  ─────────────────────────────────────────"
echo "  ClickHouse HTTP interface: http://localhost:8123"
echo "  Backend API:               http://localhost:3001"
echo "  Frontend:                  file://$(echo $ROOT)/frontend/index.html"
echo ""
echo "  Press Ctrl+C to stop the backend."
echo "  ─────────────────────────────────────────"
echo ""

wait $BACKEND_PID
