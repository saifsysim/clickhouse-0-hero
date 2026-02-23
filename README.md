# ClickHouse Explorer 🚀

> **A complete, interactive demo of ClickHouse** for developers who are new to it. Covers all major table engines and three real production use cases with live data & charts.
>
> **Branch:** `main` = ClickHouse fundamentals · `addAI` = AI engineering on top of ClickHouse

---

## What's Inside

| Section | What you learn |
|---|---|
| 🏠 **Introduction** | ClickHouse architecture, storage model, key advantages |
| ⚙️ **DB Engines** | MergeTree, SummingMergeTree, AggregatingMergeTree, ReplacingMergeTree, CollapsingMergeTree, ReplicatedMergeTree |
| 📡 **Telemetry** | High-throughput event ingestion, Materialized Views, HyperLogLog cardinality |
| 📋 **Structured Logging** | TTL auto-expiry, full-text search, error rate dashboards |
| 💰 **Cost & Usage** | SummingMergeTree auto-aggregation, budget alerts, per-team/service breakdown |
| � **Cluster & Replication** | Live 2-node cluster, Distributed table, ReplicatedMergeTree + ClickHouse Keeper |
| �🖥 **SQL Playground** | Live query editor with 9 pre-built example queries |

### 🤖 AI Layer (branch: `addAI`)

| Module | What you learn |
|---|---|
| **J1 — Text-to-SQL** | Schema injection, few-shot prompting, self-correcting retry loop |
| **J2 — Insights Agent** | Agentic tool-calling loop, structured JSON output, anomaly detection |
| **J3 — RAG** | ClickHouse as a vector store, `cosineDistance()`, embedding with Ollama |
| **J4 — MCP Server** | Build an MCP server from scratch, connect to Claude Desktop/Cursor |

**AI learning resources (in `addAI` branch):**
- 📖 [`AI_GUIDE.md`](AI_GUIDE.md) — full step-by-step walkthrough of all 4 modules
- 📝 [`backend/AI_NOTES.md`](backend/AI_NOTES.md) — developer notes, reading order, quick experiments
- 💡 [`backend/ai.js`](backend/ai.js) — all AI code, heavily commented for teaching
- 🔌 [`backend/mcp-server.js`](backend/mcp-server.js) — MCP server from scratch

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

### If you're on the `addAI` branch — additional setup

```bash
# 1. Install Ollama (local LLM — no API key needed)
curl -fsSL https://ollama.ai/install.sh | sh
# Or download: https://ollama.com/download

# 2. Pull the two models we use
ollama pull llama3.2          # 2GB — for chat, SQL, summaries
ollama pull nomic-embed-text  # 274MB — for RAG embeddings

# 3. Start Ollama (in a separate terminal)
ollama serve

# 4. Install extra npm deps
cd backend && npm install

# 5. Start the backend (Ollama must be running)
CLICKHOUSE_HOST=localhost node server.js
# → "📚 RAG knowledge base ready" means everything is working

# 6. Open the UI → click "AI Assistant" in the left sidebar
open frontend/index.html
```

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
│   ├── ai.js                  # 🤖 AI layer: Text-to-SQL, Agent, RAG
│   ├── mcp-server.js          # 🔌 MCP server for Claude/Cursor
│   ├── AI_NOTES.md            # 📝 Dev notes & learning guide for AI code
│   ├── seed.js                # DDL + demo data generator
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── index.html             # Single-page app (includes AI Assistant tab)
│   ├── style.css              # Dark glassmorphism theme
│   └── app.js                 # Chart.js + API + AI UI integration
├── AI_GUIDE.md                # 📖 Full AI engineering learning guide
├── TRAINING.md                # 📚 ClickHouse fundamentals guide
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
| `ReplicatedMergeTree` | `cluster_demo.*` | HA replication via ClickHouse Keeper |
| `Distributed` | `cluster_demo.events_dist` | Sharding across 2 nodes |

---

## API Endpoints

### Core
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

### AI (branch: `addAI`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/ai/status` | Ollama running? Which models are ready? |
| `POST` | `/api/ai/chat` | J1: `{question}` → `{sql, rows, answer}` |
| `GET` | `/api/ai/insights` | J2: `?section=all\|telemetry\|logging\|costs` → `{insights[]}` |
| `POST` | `/api/ai/rag` | J3: `{question}` → `{answer, sources, retrievedChunks}` |
| `POST` | `/api/ai/rag/index` | J3: `{source, category, text}` → embed & store |


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
