# ClickHouse Explorer 🚀

> **A complete, interactive demo of ClickHouse** for developers who are new to it. Covers all major table engines, three real production use cases with live data & charts, and an interactive **13 Mistakes** learning guide where you run "wrong" vs "fixed" code against real data.

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
| 🔥 **13 Mistakes** | Interactive "Run ❌ Wrong / ✅ Fixed" demos for the most common ClickHouse pitfalls |

---

## 🔥 Interactive 13 Mistakes Tab

The **13 Mistakes** tab teaches the most common ClickHouse pitfalls through live, executable demos.  
Seven of the thirteen mistakes have interactive panels with **three buttons**:

| Button | Action |
|---|---|
| **▶ Run ❌ Wrong** | Executes the bad pattern against real sample data → red pane shows what goes wrong |
| **▶ Run ✅ Fixed** | Executes the fix → green pane shows the improvement side-by-side |
| **↺ Reset** | Drops any temporary tables so you can run the lesson again cleanly |

**Examples of what you'll see live:**
- `#01 Parts:` 15 individual INSERTs → **15 parts** on disk vs 1 batch → **1 part**
- `#06 Dedup:` Retry same INSERT on MergeTree → **6 duplicates** vs ReplacingMergeTree + FINAL → **3 rows**
- `#07 PK:` Filter on `user_id` (not in ORDER BY) → full granule scan vs filter on `service` → index skip
- `#09 LIMIT:` Default GROUP BY LIMIT 1 → full table scan vs `optimize_aggregation_in_order=1` → early stop
- `#12 MV:` MV created after data → **0 rows** captured vs backfill `INSERT INTO SELECT` → **60,000 events**

📖 See **[MISTAKES.md](./MISTAKES.md)** for the full written guide with explanations, code samples, and links.

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
├── start.sh                   # One-click startup script
├── MISTAKES.md                # Full 13 Mistakes written guide
└── README.md
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
| `POST` | `/api/mistakes/:id-wrong` | Run the ❌ wrong pattern for mistake `id` |
| `POST` | `/api/mistakes/:id-fixed` | Run the ✅ fixed pattern for mistake `id` |
| `POST` | `/api/mistakes/:id-reset` | Drop temporary demo tables for mistake `id` |

Mistake IDs: `parts`, `nullable`, `dedup`, `pk`, `limit`, `memory`, `mv`

---

## Data Seeded

After running `seed.js`, your ClickHouse instance contains:

| Table | Engine | Rows |
|---|---|---|
| `demo.telemetry_events` | MergeTree | 60,000 |
| `demo.app_logs` | MergeTree + TTL | 100,000 |
| `demo.cost_usage` | SummingMergeTree | 20,000 |
| `demo.telemetry_hourly_agg` | AggregatingMergeTree | ~7,000 |
| `demo.error_summary` | ReplacingMergeTree | ~70 |
| `demo.budget_limits` | CollapsingMergeTree | 10 |

---

## Further Reading

- 📖 [MISTAKES.md](./MISTAKES.md) — Full 13 Mistakes reference guide
- 🔗 [ClickHouse blog: 13 common getting-started issues](https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse)
- 🔗 [Primary key & ORDER BY design guide](https://clickhouse.com/docs/en/optimize/sparse-primary-indexes)
- 🔗 [Materialized Views deep dive](https://clickhouse.com/docs/en/guides/developer/cascading-materialized-views)
