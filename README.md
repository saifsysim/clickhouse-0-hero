# ClickHouse Explorer 🚀

> **A complete, interactive demo of ClickHouse** for developers who are new to it. Covers all major table engines and three real production use cases with live data & charts.

---

## What's Inside

| Section | What you learn |
|---|---|
| 🏠 **Introduction** | ClickHouse architecture, storage model, key advantages |
| ⚙️ **DB Engines** | MergeTree, SummingMergeTree, AggregatingMergeTree, ReplacingMergeTree, CollapsingMergeTree, ReplicatedMergeTree |
| 📡 **Telemetry** | High-throughput event ingestion, Materialized Views, HyperLogLog cardinality |
| 📋 **Structured Logging** | TTL auto-expiry, full-text search, error rate dashboards |
| 💰 **Cost & Usage** | SummingMergeTree auto-aggregation, budget alerts, per-team/service breakdown |
| 🖥 **SQL Playground** | Live query editor with 9 pre-built example queries |

---

## Quick Start

### Prerequisites
- [Docker Desktop](https://docker.com) (for ClickHouse)
- [Node.js 18+](https://nodejs.org)

### One-command launch
```bash
bash start.sh
```
This will:
1. Start ClickHouse in Docker
2. Install Node dependencies
3. Seed ~90k rows of demo data
4. Start the backend API on `http://localhost:3001`
5. Open the frontend in your browser

### Manual steps (if preferred)
```bash
# 1. Start ClickHouse
docker compose up -d clickhouse

# 2. Install & seed
cd backend && npm install
CLICKHOUSE_HOST=localhost node seed.js

# 3. Start backend
CLICKHOUSE_HOST=localhost node server.js

# 4. Open frontend (no build step needed!)
open frontend/index.html
```

---

## Project Structure

```
clickhouse-explorer/
├── docker-compose.yml          # ClickHouse + backend services
├── docker/
│   └── clickhouse-config.xml  # Custom ClickHouse settings
├── backend/
│   ├── server.js              # Express API (all endpoints)
│   ├── seed.js                # DDL + demo data generator
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── index.html             # Single-page app
│   ├── style.css              # Dark glassmorphism theme
│   └── app.js                 # Chart.js + API integration
└── start.sh                   # One-click startup script
```

---

## Engines Demonstrated

| Engine | Table | Use Case |
|---|---|---|
| `MergeTree` | `telemetry_events` | Event stream, high-throughput ingest |
| `MergeTree` + TTL | `app_logs` | Auto-expiring log storage |
| `SummingMergeTree` | `cost_usage` | Auto-summing counters |
| `AggregatingMergeTree` | `telemetry_hourly_agg` | Pre-computed rollups via Materialized View |
| `ReplacingMergeTree` | `error_summary` | Upsert / deduplication |
| `CollapsingMergeTree` | `budget_limits` | In-place corrections with sign column |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | ClickHouse connectivity check |
| `POST` | `/api/query` | Generic SQL query |
| `GET` | `/api/engines` | All demo tables + engine info |
| `GET` | `/api/telemetry/stats` | Telemetry dashboard data |
| `POST` | `/api/telemetry/event` | INSERT a new event live |
| `GET` | `/api/logs` | Filtered log query |
| `GET` | `/api/logs/summary` | Log level stats + top errors |
| `GET` | `/api/costs` | Cost & usage analytics |
| `GET` | `/api/engines/*-demo` | Per-engine live results |
| `GET` | `/api/system/info` | ClickHouse server info + query log |
