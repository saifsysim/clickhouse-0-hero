# ClickHouse Explorer — Zero to Hero Training Guide

> **Who this is for:** Complete beginners to ClickHouse. You should know basic SQL (SELECT, WHERE, GROUP BY) but you do not need any prior ClickHouse experience.
>
> **What you'll build:** By the end you will have run a real 2-node distributed ClickHouse cluster, written your own tables from scratch, understand 6 engine families, and built a mini analytics pipeline.

---

## How to use this guide

Work through it **in order**. Each module builds on the previous one.

| Module | Topic | Time |
|--------|-------|------|
| 0 | Why ClickHouse? The "aha" moment | 15 min |
| 1 | Setup & first query | 20 min |
| 2 | Data types & table design | 20 min |
| 3 | INSERT best practices | 15 min |
| A | Database Engines (×6) | 60 min |
| B | Telemetry Pipeline | 30 min |
| C | Structured Logging | 25 min |
| D | Cost & Usage Analytics | 25 min |
| E | Sharding & Replication | 40 min |
| F | SQL Playground | open-ended |
| G | Common Gotchas | 15 min |
| H | Troubleshooting | reference |
| I | Capstone Project | 45 min |

---

## Module 0 — Why ClickHouse? The "Aha" Moment

Before touching any SQL, you need to feel the *problem* ClickHouse solves.

### The scenario

Your company has 1 billion rows of user events (page views, clicks, purchases). Your product manager asks:

> "How many unique users made a purchase last week, broken down by country?"

**On Postgres / MySQL:**
- The database reads every column of every qualifying row
- For 1B rows that might be 200 GB of data read from disk
- Query time: 5–20 minutes ☕

**On ClickHouse:**
- The database reads ONLY the `user_id`, `event_type`, `country`, and `timestamp` columns
- Those columns are stored together and compressed — maybe 2 GB total
- Query time: **under 1 second** ⚡

### Why is it so much faster?

```
┌─────────────────── ROW-BASED (Postgres) ────────────────────┐
│ Row 1: [id=1, user="alice", event="purchase", country="US", ts=..., session=..., ip=..., agent=...] │
│ Row 2: [id=2, user="bob",   event="click",    country="UK", ts=..., session=..., ip=..., agent=...] │
│ Row 3: [id=3, user="alice", event="purchase", country="US", ts=..., session=..., ip=..., agent=...] │
│                                                                                                      │
│ Query: SELECT country, uniq(user_id) WHERE event='purchase'                                         │
│ Must read ALL columns of ALL rows → very slow on wide tables                                        │
└──────────────────────────────────────────────────────────────┘

┌─────────────────── COLUMNAR (ClickHouse) ───────────────────┐
│ user_id col:    [alice, bob, alice, ...]   ← reads only this │
│ event_type col: [purchase, click, purchase, ...]  ← and this │
│ country col:    [US, UK, US, ...]             ← and this     │
│ timestamp col:  [...]                            ← and this  │
│                                                              │
│ session, ip, agent cols → NEVER TOUCHED for this query       │
│ Each column is stored compressed separately → tiny I/O       │
└──────────────────────────────────────────────────────────────┘
```

### When to use ClickHouse vs Postgres

| Use ClickHouse | Use Postgres |
|---|---|
| Analytics dashboards | User accounts, logins |
| Event/click stream data | Shopping cart state |
| Logs and metrics | Financial transactions |
| Time-series data | Relational joins across many tables |
| Aggregate reports | Row-level UPDATE/DELETE heavy workloads |
| Billions of rows | Thousands/millions of rows |

> **Rule of thumb:** If your query has `GROUP BY` + `COUNT`/`SUM`/`AVG` and touches millions of rows, ClickHouse will be faster. If your query looks up a single user by ID and updates their profile, use Postgres.

---

## Module 1 — Setup & Your First Query

### What you need

| Tool | Version | How to check |
|------|---------|--------------|
| Docker Desktop | 24+ | `docker --version` |
| Node.js | 18+ | `node --version` |
| Any modern browser | — | — |

### Start the app

```bash
# From the project root directory:
bash start.sh
```

This automatically:
1. Starts ClickHouse in Docker on port `8123`
2. Installs backend dependencies
3. Seeds **90,000 rows** across 5 demo tables
4. Starts the API server on port `3001`
5. Opens the explorer in your browser

Also start the cluster (needed for Module E):

```bash
docker compose up -d clickhouse-keeper clickhouse-node1 clickhouse-node2
cd backend && node seed-cluster.js
```

### Verify everything works

Open your browser and check:

```
http://localhost:3001/api/health   → { "status": "connected" }
http://localhost:8123/ping         → Ok.
http://localhost:8124/ping         → Ok.   (cluster node 1)
http://localhost:8125/ping         → Ok.   (cluster node 2)
```

The status badge at the bottom-left of the Explorer app should show 🟢 **Connected**.

### Your very first ClickHouse query

Open the **SQL Playground** tab and run:

```sql
SELECT
  service,
  count()       AS total_events,
  uniq(user_id) AS unique_users
FROM demo.telemetry_events
GROUP BY service
ORDER BY total_events DESC
```

You just ran an aggregate over 30,000 rows across 7 services. Notice the execution time — typically **< 20ms**. That same query on a typical Postgres setup with 30k rows would be ~5ms, but at 30 *million* rows ClickHouse would still be ~20ms while Postgres would be ~30 seconds.

---

## Module 2 — Data Types & Table Design

This is the most important module for beginners. Choosing the wrong types is the #1 mistake that hurts performance.

### Core numeric types

| Type | Range | Bytes | Use for |
|------|-------|-------|---------|
| `UInt8` | 0–255 | 1 | Boolean flags, small counts |
| `UInt16` | 0–65,535 | 2 | Port numbers, small IDs |
| `UInt32` | 0–4.3B | 4 | Row counts, durations (ms) |
| `UInt64` | 0–18.4Q | 8 | Token counts, large IDs |
| `Int32` | ±2.1B | 4 | Signed counters, temperatures |
| `Float32` | 7 sig. digits | 4 | Coordinates, approximate values |
| `Float64` | 15 sig. digits | 8 | Financial amounts (use Decimal for exact) |
| `Decimal(18,4)` | exact | 9 | Money — never use Float for currency! |

### String types

```sql
-- Bad — wastes space, slow GROUP BY:
service String

-- Good — dictionary encoded, fast:
service LowCardinality(String)   -- use when < ~10,000 unique values

-- Good — fixed size, stored as bytes:
status_code FixedString(3)       -- e.g. '200', '404'

-- Good — RFC UUID:
request_id UUID                  -- stored as 16 bytes, not 36-char string
```

> **Rule:** Use `LowCardinality(String)` for any column with fewer than ~10,000 distinct values (status codes, countries, service names, log levels). It applies dictionary encoding automatically and can make GROUP BY 3–5× faster.

### Date/time types

```sql
timestamp    DateTime      -- seconds precision, stored as UInt32  (recommended)
created_at   DateTime64(3) -- millisecond precision, stored as Int64
event_date   Date          -- just the date, 2 bytes (use for PARTITION BY)
```

> **Rule:** Use `DateTime` for most timestamps. Use `DateTime64(3)` only if you genuinely need millisecond precision.

### Nullable — avoid it

```sql
-- Avoid! Nullable wraps every value in an extra byte:
user_id Nullable(String)

-- Better — use a default empty value:
user_id String DEFAULT ''

-- Or a sentinel value:
duration_ms UInt32 DEFAULT 0
```

> ClickHouse stores a separate "null bitmap" for Nullable columns. This adds overhead and slows down aggregations. Only use `Nullable` if `NULL` has a genuine semantic meaning you need to differentiate from zero/empty.

### Designing your first table — a checklist

```sql
CREATE TABLE my_events
(
  -- 1. Always put timestamp first (needed for PARTITION BY)
  timestamp   DateTime,

  -- 2. Use LowCardinality for low-distinct-value strings
  service     LowCardinality(String),
  environment LowCardinality(String),

  -- 3. Use appropriate numeric sizes
  user_id     UInt64,
  duration_ms UInt32,
  status_code UInt16,

  -- 4. High-cardinality strings go last
  trace_id    String,
  message     String
)
ENGINE = MergeTree()

-- 5. Partition by month (or day for very high volume)
PARTITION BY toYYYYMM(timestamp)

-- 6. ORDER BY: most-filtered columns first, time last
ORDER BY (service, environment, timestamp)

-- 7. Optional: auto-delete old data
TTL timestamp + INTERVAL 90 DAY
```

### Exercise 2A — Inspect the demo tables

In the SQL Playground, run:

```sql
SELECT
  name,
  type,
  default_expression,
  comment
FROM system.columns
WHERE database = 'demo'
  AND table = 'telemetry_events'
ORDER BY position
```

Look at the types chosen for each column. Notice `LowCardinality` on `service` and `event_type`.

### Exercise 2B — Check compression ratios

```sql
SELECT
  table,
  formatReadableSize(sum(data_compressed_bytes))   AS compressed,
  formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed,
  round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 1) AS ratio
FROM system.columns
WHERE database = 'demo'
GROUP BY table
ORDER BY sum(data_compressed_bytes) DESC
```

You'll typically see 5–15× compression ratios — far better than row-based databases.

---

## Module 3 — INSERT Best Practices

This is where most ClickHouse beginners make critical mistakes.

### The golden rule: batch your inserts

```sql
-- ❌ NEVER DO THIS — one INSERT per row:
INSERT INTO events VALUES (now(), 'frontend', 'page_view', 'user-1')
INSERT INTO events VALUES (now(), 'frontend', 'click',     'user-2')
INSERT INTO events VALUES (now(), 'api',      'request',   'user-3')
-- This creates 3 separate parts on disk. At 1000 rows/s, you'd
-- have 1000 parts after 1 second → ClickHouse struggles to merge → slow queries
```

```sql
-- ✅ DO THIS — one INSERT for many rows:
INSERT INTO events VALUES
  (now(), 'frontend', 'page_view', 'user-1'),
  (now(), 'frontend', 'click',     'user-2'),
  (now(), 'api',      'request',   'user-3'),
  -- ... thousands more rows
  (now(), 'backend',  'response',  'user-999')
-- One INSERT = one part. Much better.
```

> **Rule:** Aim for batches of **1,000–100,000 rows** per INSERT. Never insert row-by-row in a loop.

### Why small inserts are dangerous

Every INSERT creates a new **data part** on disk. ClickHouse has a limit (typically 300 parts per partition). If you exceed it, ClickHouse starts returning `Too many parts` errors and refusing writes.

```sql
-- Check how many parts your table has (should be < 100 per partition):
SELECT
  partition,
  count() AS parts,
  sum(rows) AS total_rows
FROM system.parts
WHERE table = 'telemetry_events' AND active = 1
GROUP BY partition
ORDER BY parts DESC
```

### INSERT formats

ClickHouse accepts many formats. JSON is the easiest from application code:

```sql
-- JSONEachRow: one JSON object per line
INSERT INTO events FORMAT JSONEachRow
{"timestamp":"2024-01-01 12:00:00","service":"frontend","event_type":"click"}
{"timestamp":"2024-01-01 12:00:01","service":"backend","event_type":"request"}
```

From the ClickHouse Node.js client (used in this project):

```javascript
await client.insert({
  table: 'demo.telemetry_events',
  values: [
    { timestamp: '2024-01-01 12:00:00', service: 'frontend', event_type: 'click' },
    // ... thousands more
  ],
  format: 'JSONEachRow',
});
```

### Async vs sync inserts

By default, ClickHouse acknowledges an INSERT after it writes to disk (synchronous). This is safe but slow for tiny batches. The alternative is **async inserts** — ClickHouse buffers small writes and flushes them in batches:

```sql
-- Enable async inserts (good for high-frequency single-row use cases):
SET async_insert = 1;
SET wait_for_async_insert = 0;  -- don't wait for ack
INSERT INTO events VALUES (now(), 'frontend', 'click', 'user-42')
-- ClickHouse collects this in a buffer and flushes when buffer fills or timer fires
```

> Use async inserts if your application truly cannot batch writes (e.g., one event at a time from many clients).

---

## Module A — Database Engines

> **Open in the app:** Click **"DB Engines"** in the sidebar.
> **Time:** ~60 minutes total (10 min per engine)

ClickHouse has a family of storage engines, all based on **MergeTree**. The engine controls what happens when data is *merged* — the background process that compacts small parts into larger ones.

---

### A1. MergeTree — The Foundation  ⏱ 10 min

**Plain English:** Write data, ClickHouse sorts it by your `ORDER BY` key, and periodically merges parts. During merges, nothing special happens — data is just re-sorted and compressed more efficiently.

**Use when:** You need fast appends and fast range queries. This is the default choice.

```sql
CREATE TABLE demo.telemetry_events
(
  timestamp   DateTime,
  service     LowCardinality(String),
  event_type  LowCardinality(String),
  user_id     String,
  properties  String,
  duration_ms UInt32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, event_type, timestamp)
```

**Steps:**

1. **Run this in SQL Playground** — understand the ORDER BY:
```sql
-- FAST: 'service' is first in ORDER BY — uses sparse index
SELECT count() FROM demo.telemetry_events WHERE service = 'frontend'

-- SLOWER: 'user_id' is NOT in ORDER BY — full scan
SELECT count() FROM demo.telemetry_events WHERE user_id = 'user-1'
```

2. **Check the physical parts:**
```sql
SELECT partition, name, rows, formatReadableSize(bytes_on_disk) AS size
FROM system.parts
WHERE table = 'telemetry_events' AND active = 1
ORDER BY partition, min_time
```

3. **💡 Key insight:** Design `ORDER BY` around your most common WHERE/GROUP BY columns. Get this right at creation time — you cannot change it later without rewriting all data.

---

### A2. ReplacingMergeTree — Upserts  ⏱ 10 min

**Plain English:** During merges, if two rows have the same `ORDER BY` key, only the **latest version** survives. This gives you upsert-like semantics without the cost of UPDATE.

**Use when:** You want to track the "latest state" — user profiles, status of an order, deduplicated errors.

```sql
CREATE TABLE demo.error_summary
(
  error_hash   String,
  service      LowCardinality(String),
  message      String,
  count        UInt32,
  last_seen    DateTime,
  version      UInt64    -- higher version wins on merge
)
ENGINE = ReplacingMergeTree(version)
ORDER BY error_hash
```

**Steps:**

1. **Insert two versions of the same error:**
```sql
INSERT INTO demo.error_summary VALUES
  ('hash-abc', 'frontend', 'Auth failed', 5,  now()-3600, 1),
  ('hash-abc', 'frontend', 'Auth failed', 12, now(),      2)
```

2. **Without FINAL — may see both rows (merge not run yet):**
```sql
SELECT * FROM demo.error_summary WHERE error_hash = 'hash-abc'
```

3. **With FINAL — always deduplicated:**
```sql
SELECT * FROM demo.error_summary FINAL WHERE error_hash = 'hash-abc'
```

4. **💡 Key insight:** `FINAL` forces synchronous deduplication at query time. It's slower than without FINAL but always correct. Use it when you need exact results. Without FINAL, queries are faster but may return duplicates if a merge hasn't run yet.

---

### A3. SummingMergeTree — Auto-Aggregation  ⏱ 10 min

**Plain English:** During merges, rows with the same `ORDER BY` key are **collapsed into one** by summing all numeric columns. You get free pre-aggregation as a side effect of compaction.

**Use when:** Counters, totals, usage aggregates — any case where you only ever need `SUM`.

```sql
CREATE TABLE demo.cost_usage
(
  timestamp   DateTime,
  service     LowCardinality(String),
  team        LowCardinality(String),
  cost_usd    Float64,    -- ← auto-summed during merge
  tokens_used UInt64,     -- ← auto-summed
  api_calls   UInt32      -- ← auto-summed
)
ENGINE = SummingMergeTree()
ORDER BY (team, service, toStartOfHour(timestamp))
```

**Steps:**

1. **Query totals — always use sum() even with SummingMergeTree:**
```sql
SELECT team, sum(cost_usd) AS total
FROM demo.cost_usage
GROUP BY team ORDER BY total DESC
```

2. **Insert a new cost row:**
```sql
INSERT INTO demo.cost_usage VALUES (now(), 'ml-inference', 'infra', 100.00, 50000, 200)

-- Immediately verify it shows up:
SELECT service, sum(cost_usd) FROM demo.cost_usage
WHERE service = 'ml-inference' GROUP BY service
```

3. **💡 Key insight:** Always use `sum()` in queries — even after merges that summed rows, there may be unmerged parts from recent inserts. The `sum()` in your GROUP BY catches both cases and is always correct.

---

### A4. AggregatingMergeTree — Partial States  ⏱ 10 min

**Plain English:** Instead of storing raw values, it stores **partial aggregate states** — like an HyperLogLog sketch for unique counts, or a t-digest for quantiles. This lets you merge partial results from many inserts without losing accuracy.

**Use when:** You need approximate DISTINCT counts or quantiles over billions of rows, pre-computed via Materialized Views.

```sql
-- Usually created via a Materialized View that feeds this engine:
CREATE MATERIALIZED VIEW demo.telemetry_hourly_agg
ENGINE = AggregatingMergeTree()
ORDER BY (service, event_type, hour)
AS SELECT
  toStartOfHour(timestamp)       AS hour,
  service,
  event_type,
  uniqState(user_id)             AS users_state,    -- HLL sketch bytes
  quantileState(0.95)(duration_ms) AS p95_state     -- t-digest bytes
FROM demo.telemetry_events
GROUP BY hour, service, event_type
```

**Steps:**

1. **Query with the Merge functions (not the regular ones):**
```sql
SELECT
  hour,
  service,
  uniqMerge(users_state)         AS approx_unique_users,
  quantileMerge(0.95)(p95_state) AS p95_duration_ms
FROM demo.telemetry_hourly_agg
GROUP BY hour, service
ORDER BY hour DESC LIMIT 20
```

2. **Compare storage sizes:**
```sql
SELECT
  table,
  formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE database = 'demo' AND active = 1
  AND table IN ('telemetry_events', 'telemetry_hourly_agg')
GROUP BY table
```

3. **💡 Key insight:** The pair `uniqState()` (in the Materialized View) + `uniqMerge()` (in queries) is how you get approximate distinct counts that are 100x faster than `COUNT(DISTINCT)` on raw data.

---

### A5. CollapsingMergeTree — Corrections / Undo  ⏱ 10 min

**Plain English:** Uses a `sign` column. A row with `sign = 1` is a "write". A row with `sign = -1` is a cancellation of the previous write. During merges, matching pairs cancel each other out — like accounting's debit/credit system.

**Use when:** Budget corrections, order cancellations, session tracking, any "undo" pattern.

```sql
CREATE TABLE demo.budget_limits
(
  team      LowCardinality(String),
  service   LowCardinality(String),
  limit_usd Float64,
  sign      Int8,     -- +1 = set,  -1 = cancel
  version   UInt32
)
ENGINE = CollapsingMergeTree(sign)
ORDER BY (team, service, version)
```

**Steps:**

1. **Write a budget, then correct it:**
```sql
-- Original budget:
INSERT INTO demo.budget_limits VALUES ('infra', 'api-gateway', 500.00, 1, 1)
-- Cancel it:
INSERT INTO demo.budget_limits VALUES ('infra', 'api-gateway', 500.00, -1, 1)
-- New corrected budget:
INSERT INTO demo.budget_limits VALUES ('infra', 'api-gateway', 750.00,  1, 2)
```

2. **Always query net values using `sign`:**
```sql
-- CORRECT: multiply by sign to get net result
SELECT team, service, sum(limit_usd * sign) AS net_budget
FROM demo.budget_limits
GROUP BY team, service
HAVING net_budget > 0

-- WRONG: ignores sign, double-counts
SELECT team, service, sum(limit_usd) AS wrong
FROM demo.budget_limits
GROUP BY team, service
```

3. **💡 Key insight:** CollapsingMergeTree never actually deletes data — cancellations are just new rows with `sign = -1`. This makes it fully append-only while supporting corrections. Always use `sum(value * sign)` in queries.

---

### A6. ReplicatedMergeTree — High Availability  ⏱ 10 min

**Plain English:** Any MergeTree engine prefixed with `Replicated` adds automatic synchronization across multiple nodes via **ClickHouse Keeper** (ZooKeeper-compatible). Every INSERT is logged in Keeper and replayed on all replicas.

**Use when:** You need fault tolerance — if one node dies, others keep serving queries.

```sql
-- Every replica runs this same DDL, but {shard} and {replica}
-- expand to different values per node via macros:
ENGINE = ReplicatedMergeTree(
  '/clickhouse/tables/{shard}/events',  -- ZK path (shared by replicas of same shard)
  '{replica}'                           -- unique per node: replica-1, replica-2
)
ORDER BY (service, timestamp)
```

**Live demo in Module E** — skip ahead there to see it in action.

---

## Module B — Telemetry Pipeline  ⏱ 30 min

> **Open in the app:** Click **"Telemetry"** in the sidebar.

### What is a telemetry pipeline?

Telemetry = collecting behavioral events from your application. Things like:
- User clicked a button
- API request took 450ms
- A purchase completed successfully

At scale, this is millions of events per day per service. ClickHouse handles it by design.

### The pipeline in this demo

```
App Services (7 microservices)
    │
    │  INSERT batch (1000 events at a time)
    ▼
demo.telemetry_events             ← MergeTree (raw events, ~30k rows)
    │
    ├──▶ demo.telemetry_hourly_agg  ← Materialized View → AggregatingMergeTree
    │        (auto-updated on every INSERT — no extra code needed)
    │
    └──▶ demo.error_summary         ← ReplacingMergeTree (deduped errors)
```

### Step-by-step

**Step 1 — KPI cards (15 min read)**

When you open Telemetry, four numbers appear instantly. Each is a different aggregate:

```sql
SELECT
  count()                    AS total_events,     -- simple count
  uniq(user_id)              AS unique_users,      -- HLL approximate distinct
  uniq(service)              AS active_services,   -- HLL
  quantile(0.95)(duration_ms) AS p95_duration_ms  -- 95th percentile latency
FROM demo.telemetry_events
WHERE timestamp >= now() - INTERVAL 24 HOUR
```

All four computed in ONE query, ONE pass over the data. ClickHouse vectorizes all four aggregations simultaneously.

**Step 2 — The stacked area chart**

```sql
SELECT
  toStartOfHour(timestamp) AS hour,
  event_type,
  count() AS cnt
FROM demo.telemetry_events
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY hour, event_type
ORDER BY hour
```

`toStartOfHour()` is one of 40+ time bucketing functions. Others:
- `toStartOfDay()`, `toStartOfWeek()`, `toStartOfMonth()`
- `toStartOf15Minutes()`, `toStartOf5Minutes()`

**Step 3 — Inject a live event**

Click **Inject Event** in the app. This runs:

```sql
INSERT INTO demo.telemetry_events VALUES
  (now(), 'payment-service', 'purchase', 'user-42', '{}', 450)
```

Refresh the chart. The new event appears in the latest hour bucket.

**Step 4 — SQL exercises**

```sql
-- Conversion funnel: views → clicks → purchases
SELECT
  toStartOfHour(timestamp) AS hour,
  countIf(event_type = 'page_view') AS views,
  countIf(event_type = 'click')     AS clicks,
  countIf(event_type = 'purchase')  AS purchases,
  round(countIf(event_type='purchase')
        / nullIf(countIf(event_type='page_view'), 0) * 100, 2) AS conv_pct
FROM demo.telemetry_events
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY hour ORDER BY hour

-- P50 / P95 / P99 latency per service
SELECT
  service,
  quantile(0.50)(duration_ms) AS p50,
  quantile(0.95)(duration_ms) AS p95,
  quantile(0.99)(duration_ms) AS p99
FROM demo.telemetry_events
GROUP BY service ORDER BY p95 DESC
```

**Step 5 — Compare raw vs Materialized View**

```sql
-- Raw query (reads all ~30k rows):
SELECT service, uniq(user_id) AS unique_users
FROM demo.telemetry_events
GROUP BY service

-- Same result from the pre-aggregated MV (reads tiny AggregatingMergeTree):
SELECT service, uniqMerge(users_state) AS unique_users
FROM demo.telemetry_hourly_agg
GROUP BY service
```

At 30k rows the difference is small, but at 30 billion rows the MV would be 10,000× faster.

---

## Module C — Structured Logging  ⏱ 25 min

> **Open in the app:** Click **"Structured Logging"** in the sidebar.

### Why ClickHouse for logs?

Traditional log stacks (ELK = Elasticsearch + Logstash + Kibana) are expensive and complex. ClickHouse stores logs columnar:
- Filter by `level` + `service`? Only those two columns are read — the giant `message` column is untouched.
- Auto-delete old logs with TTL — no cron jobs.
- Compress logs 10–15× (logs are very repetitive text).

### The table design

```sql
CREATE TABLE demo.app_logs
(
  timestamp   DateTime,
  level       LowCardinality(String),   -- DEBUG/INFO/WARN/ERROR
  service     LowCardinality(String),
  host        LowCardinality(String),
  message     String,
  trace_id    String,
  duration_ms UInt32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (level, service, timestamp)
TTL timestamp + INTERVAL 90 DAY
```

**Notice:** `TTL timestamp + INTERVAL 90 DAY` — ClickHouse automatically drops partitions older than 90 days. Zero maintenance.

### Step-by-step

**Step 1 — Level KPIs**

```sql
SELECT level, count() AS cnt
FROM demo.app_logs
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY level ORDER BY cnt DESC
```

**Step 2 — Filtered log search**

Use the filter dropdowns in the app (Level=ERROR, Service=payment-service). The SQL:

```sql
SELECT timestamp, level, service, host, message, trace_id, duration_ms
FROM demo.app_logs
WHERE level = 'ERROR'
  AND service = 'payment-service'
ORDER BY timestamp DESC LIMIT 100
```

Because `level` and `service` are the **first two columns in ORDER BY**, ClickHouse uses its sparse index to skip most of the table. This query touches a tiny fraction of the data even with 50k rows.

**Step 3 — Error rate over time**

```sql
SELECT
  toStartOfHour(timestamp) AS hour,
  countIf(level = 'ERROR')  AS errors,
  count()                   AS total,
  round(countIf(level = 'ERROR') / count() * 100, 2) AS error_pct
FROM demo.app_logs
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY hour ORDER BY hour
```

**Step 4 — Full-text search**

```sql
-- ILIKE for case-insensitive contains
SELECT timestamp, service, message
FROM demo.app_logs
WHERE message ILIKE '%timeout%'
ORDER BY timestamp DESC LIMIT 20
```

**Step 5 — Verify the TTL**

```sql
SELECT table, engine_full, ttl_expression
FROM system.tables
WHERE database = 'demo' AND name = 'app_logs'
```

---

## Module D — Cost & Usage Analytics  ⏱ 25 min

> **Open in the app:** Click **"Cost & Usage"** in the sidebar.

### The use case

Track API spending, token consumption, and per-team budgets in real time. SummingMergeTree means you never need a separate aggregation job — ClickHouse does it for free during background merges.

### Step-by-step

**Step 1 — Read the KPI numbers**

```sql
SELECT
  sum(cost_usd)    AS total_spend,
  sum(tokens_used) AS total_tokens,
  sum(api_calls)   AS total_calls,
  round(sum(cost_usd) / sum(api_calls) * 1000, 2) AS cost_per_1k
FROM demo.cost_usage
WHERE timestamp >= now() - INTERVAL 30 DAY
```

**Step 2 — Budget alerts**

```sql
SELECT service, team, sum(cost_usd) AS daily_cost
FROM demo.cost_usage
WHERE toDate(timestamp) = today()
GROUP BY service, team
HAVING daily_cost > 50
ORDER BY daily_cost DESC
```

`HAVING` filters after aggregation — used here to only show overspending services.

**Step 3 — Week-over-week change**

```sql
SELECT
  service,
  sumIf(cost_usd, timestamp >= now() - INTERVAL 7 DAY)  AS this_week,
  sumIf(cost_usd, timestamp BETWEEN now() - INTERVAL 14 DAY
                             AND    now() - INTERVAL 7 DAY) AS last_week
FROM demo.cost_usage
GROUP BY service ORDER BY this_week DESC
```

`sumIf(col, condition)` is ClickHouse's version of `SUM(CASE WHEN … END)` — cleaner and faster.

**Step 4 — Running total (window function)**

```sql
SELECT
  day,
  daily_cost,
  sum(daily_cost) OVER (ORDER BY day) AS cumulative_spend
FROM (
  SELECT toDate(timestamp) AS day, sum(cost_usd) AS daily_cost
  FROM demo.cost_usage
  WHERE timestamp >= now() - INTERVAL 30 DAY
  GROUP BY day ORDER BY day
)
ORDER BY day
```

ClickHouse supports standard SQL window functions: `SUM() OVER`, `ROW_NUMBER()`, `RANK()`, `LAG()`, `LEAD()`.

---

## Module E — Sharding & Replication  ⏱ 40 min

> **Open in the app:** Click **"Cluster & Replication"** in the sidebar.
> **Requires:** cluster containers running (`docker compose up -d clickhouse-keeper clickhouse-node1 clickhouse-node2`)

### Two concepts, one cluster

| Concept | Solves | Mechanism |
|---------|--------|-----------|
| **Sharding** | Data too large for one node | Split rows across nodes by hash |
| **Replication** | Single node = single point of failure | Copy every write to N nodes |

This demo runs **2 nodes** demonstrating both:
- **Sharding:** node1 = shard01, node2 = shard02 → data is split between them
- **Replication:** both nodes share a ZK path for `events_replicated` → writes to node1 appear on node2

### The live architecture

```
Your App
    │
    │  INSERT
    ▼
events_distributed              ← Distributed engine (query router, no storage)
ENGINE = Distributed(
  demo_cluster,                 ← which cluster
  cluster_demo,                 ← database
  events_local,                 ← local table on each shard
  murmurHash3_32(user_id)       ← sharding key (hash of user_id)
)
    │
    │  hash(user_id) % 2
    ├──── shard 01 ─────▶ clickhouse-node1:8124 (events_local, replica-1)
    └──── shard 02 ─────▶ clickhouse-node2:8125 (events_local, replica-2)
              │                      │
              └──── Keeper (9181) ───┘
               coordinates replication of events_replicated
```

### Step-by-step

**Step 1 — Check the topology**

```sql
-- Run this in SQL Playground (it queries node1 via the API):
SELECT cluster, shard_num, replica_num, host_name, port, is_local
FROM system.clusters
WHERE cluster IN ('demo_cluster', 'ha_cluster')
ORDER BY cluster, shard_num
```

You'll see:
- `demo_cluster`: shard 1 (node1) + shard 2 (node2) — for horizontal scale
- `ha_cluster`: shard 1 replica 1 (node1) + shard 1 replica 2 (node2) — for HA

**Step 2 — Understand the macros**

Each node has a `/etc/clickhouse-server/config.d/macros.xml` file:

```xml
<!-- node1 -->
<macros>
  <shard>01</shard>
  <replica>replica-1</replica>
</macros>

<!-- node2 -->
<macros>
  <shard>02</shard>
  <replica>replica-2</replica>
</macros>
```

When you write `ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events', '{replica}')`, ClickHouse substitutes these macros at table creation time. So:
- node1 creates ZK path `/clickhouse/tables/01/events` as `replica-1`
- node2 creates ZK path `/clickhouse/tables/02/events` as `replica-2`

Different ZK paths = different shards. Same ZK path = replicas of the same shard.

**Step 3 — Sharding demo**

In the app, click **"⚡ INSERT & Route"** with user_id = `user-42`.

Behind the scenes:
```
murmurHash3_32('user-42') = 3073060364
3073060364 % 2 = 0  →  shard 02  →  node2
```

Every time you insert `user-42`, it goes to node2. Same user, same shard — this is **data locality**.

**Step 4 — Cross-shard query**

```sql
-- This runs on BOTH shards in parallel, then merges results:
SELECT service, count() AS events, uniq(user_id) AS unique_users
FROM cluster_demo.events_distributed
GROUP BY service ORDER BY events DESC
```

node1 coordinates: sends sub-queries to both shards, gets partial results, merges them. You see unified output as if it's one table.

**Step 5 — Replication proof**

Click **"✍️ Write to node1 → Verify on node2"** in the app.

What happens internally:
```
1. INSERT into events_replicated on node1
2. ClickHouse writes data locally to node1
3. ClickHouse logs the INSERT to Keeper:
     /clickhouse/tables/ha/events_replicated/log/log-0000001
4. node2 is watching the Keeper log
5. node2 sees the new entry, pulls the data from node1
6. node2 applies it to its local events_replicated table
7. After ~1 second: node2 has the same data
```

**Step 6 — ON CLUSTER DDL**

In real production, you run DDL on all nodes at once:

```sql
-- Creates the table on EVERY node in the cluster simultaneously:
CREATE TABLE IF NOT EXISTS cluster_demo.test_table
ON CLUSTER demo_cluster
(
  id    UInt64,
  value String
)
ENGINE = ReplicatedMergeTree(
  '/clickhouse/tables/{shard}/test_table',
  '{replica}'
)
ORDER BY id;

-- Clean up:
DROP TABLE IF EXISTS cluster_demo.test_table ON CLUSTER demo_cluster;
```

**Step 7 — Choosing a sharding key**

This is a critical production decision:

```sql
-- ✅ Good: user_id → data locality, even distribution
ENGINE = Distributed(cluster, db, t, murmurHash3_32(user_id))

-- ✅ Good: rand() → perfectly even, no locality
ENGINE = Distributed(cluster, db, t, rand())

-- ⚠️ Risky: timestamp → hot-spot! All recent data → shard 1
ENGINE = Distributed(cluster, db, t, toUnixTimestamp(timestamp))

-- ⚠️ Risky: low cardinality → skew! If 'US' has 80% of data → shard 1 overloaded
ENGINE = Distributed(cluster, db, t, country)
```

**Rule:** Use `user_id` (or your primary entity ID) for user-centric analytics. Use `rand()` when you have no dominant query pattern.

---

## Module F — SQL Playground  ⏱ Open-ended

> **Open in the app:** Click **"SQL Playground"** in the sidebar.

The playground is connected directly to your live ClickHouse instance. Run any query. Hit `⌘ Enter` to execute.

### Built-in quick queries — what each one teaches

| Button | Key concept |
|--------|-------------|
| 📊 Events by Hour | `toStartOfHour()` time bucketing |
| 👤 Top Users | Basic GROUP BY + LIMIT |
| 🔴 Error Rate | `countIf()` conditional aggregation |
| 💰 Cost by Service | SummingMergeTree queries |
| ⏱ P95 Latency | `quantile(N)(col)` function |
| 🔢 HLL Users | `uniqHLL12()` vs `uniqExact()` |
| 📋 System Tables | Introspecting ClickHouse internals |
| 📉 Budget Collapse | CollapsingMergeTree sign pattern |
| ⏳ TTL Info | Reading TTL expressions |

### Must-try queries

**Compare HLL approximations:**
```sql
SELECT
  service,
  uniq(user_id)       AS hll_approx,      -- fast, ~2% error
  uniqExact(user_id)  AS exact            -- slower, 100% accurate
FROM demo.telemetry_events
GROUP BY service
```

**Window functions:**
```sql
SELECT
  user_id,
  timestamp,
  event_type,
  row_number() OVER (PARTITION BY user_id ORDER BY timestamp) AS event_num
FROM demo.telemetry_events
WHERE user_id = 'user-1'
ORDER BY timestamp LIMIT 20
```

**Query the query log (meta!):**
```sql
SELECT
  left(query, 60) AS query_snippet,
  query_duration_ms,
  read_rows,
  formatReadableSize(memory_usage) AS mem
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 10 MINUTE
ORDER BY query_duration_ms DESC LIMIT 10
```

---

## Module G — Common Gotchas  ⏱ 15 min

These are the mistakes everyone makes their first week with ClickHouse.

---

### Gotcha 1 — Forgetting `FINAL` with ReplacingMergeTree

> **Why this happens:** ReplacingMergeTree deduplicates rows *only during background part merges*, not at insert time. A merge might not have run yet when you query — so both the old and new version of a row can coexist in different parts simultaneously. Your query sees all parts, and without `FINAL` it returns every row from every part, including "stale" duplicates.

```sql
-- ❌ May return 2 rows for the same error_hash (merge hasn't run yet):
SELECT * FROM demo.error_summary WHERE error_hash = 'hash-abc'
-- Output: row v1, row v2  ← both exist in different parts

-- ✅ FINAL forces deduplication at query time — always safe:
SELECT * FROM demo.error_summary FINAL WHERE error_hash = 'hash-abc'
-- Output: row v2  ← only the latest version

-- ✅ Alternative — lightweight, no FINAL needed:
SELECT error_hash, argMax(message, version) AS message, max(version) AS version
FROM demo.error_summary
GROUP BY error_hash
-- argMax(col, version) returns the col value from the row with the highest version
```

**Rule:** Use `FINAL` when you need *exact* deduplicated results. Avoid it on very large tables (it triggers a synchronous merge) — prefer the `argMax` pattern for high-throughput dashboards.

---

### Gotcha 2 — Using `Float` for money

> **Why this happens:** Float32 and Float64 use [IEEE 754 binary floating-point](https://en.wikipedia.org/wiki/IEEE_754) — the same format used in almost every programming language. Binary floats *cannot represent most decimal fractions exactly*. The decimal number `0.1` has no exact binary representation, just like `1/3` has no exact decimal representation. This causes silent rounding errors that accumulate over millions of transactions, making financial totals wrong.

```sql
-- ❌ Float64 silently introduces rounding errors:
SELECT 0.1 + 0.2    -- returns 0.30000000000000004  ← WRONG for money

-- ❌ Never define financial columns as Float:
cost_usd Float64

-- ✅ Decimal stores exactly what you put in — no rounding:
SELECT toDecimal64(0.1, 4) + toDecimal64(0.2, 4)  -- returns 0.3000 ← exact

-- ✅ Always use Decimal for any currency or financial column:
cost_usd    Decimal(18, 4)   -- 18 total digits, 4 decimal places
-- Decimal(18,4) can store values up to 99,999,999,999,999.9999
-- That covers any realistic monetary amount

-- ✅ For token counts, percentages, coordinates — Float is fine:
latitude    Float32    -- a tiny imprecision in GPS is not a problem
score       Float64    -- rounding errors in ML scores are acceptable
```

**Rule:** Any column that represents money, prices, costs, or financial totals → use `Decimal(18, 4)`. Everything else → `Float64` is fine.

---

### Gotcha 3 — Too many partitions

> **Why this happens:** ClickHouse stores each partition as a separate directory on disk. Every query that touches a table must open and check the file system metadata for each partition — even ones that will be pruned. If you have 1 million partitions (e.g., `PARTITION BY user_id`), opening your table itself becomes slow. ClickHouse also has internal limits (typically 1,000 partitions per table by default) and will refuse queries or writes once exceeded.

```sql
-- ❌ NEVER partition by a high-cardinality column:
PARTITION BY user_id
-- With 500,000 users → 500,000 directories on disk
-- Every SELECT scans all 500,000 partition folders before pruning

-- ❌ Over-partitioning by day can also hurt:
PARTITION BY toDate(timestamp)
-- With 3 years of data → 1,095 partitions
-- Each partition has its own set of parts — hard to manage

-- ✅ Partition by month — typically the sweet spot:
PARTITION BY toYYYYMM(timestamp)    -- ~12 partitions/year → 36 for 3 years

-- ✅ For very high-volume tables (billions of rows/day):
PARTITION BY toDate(timestamp)      -- daily is fine IF you have few days of data
                                    -- or your TTL drops old ones quickly
```

**Rule:** Target 10–100 partitions total per table. Partition by time (month or day), never by user or entity ID.

---

### Gotcha 4 — Single-row inserts

> **Why this happens:** In ClickHouse, every `INSERT` statement writes a new **data part** — a folder on disk containing sorted column files. ClickHouse has a background merger that compacts small parts into larger ones, but it can only merge so fast. If you insert 1 row at a time at high speed, you create parts faster than ClickHouse can merge them. Once the number of parts per partition exceeds ~300, ClickHouse starts returning `DB::Exception: Too many parts` errors and **stops accepting writes entirely** until the backlog clears.

```sql
-- ❌ Classic beginner mistake — a loop of single inserts:
for user_event in events:
    INSERT INTO demo.telemetry_events VALUES (user_event)
-- At 1,000 events/second → 1,000 parts/second
-- ClickHouse can merge ~50 parts/second → backlog grows → eventual crash

-- ❌ Even 10 rows per insert is too few for any real workload.

-- ✅ Collect rows in your application, flush in large batches:
INSERT INTO demo.telemetry_events VALUES
  (row1), (row2), (row3), ..., (row5000)  -- single INSERT, one part
-- ClickHouse can handle 1–10 inserts/second efficiently at this batch size

-- ✅ Check current part count per partition (alert if > 100):
SELECT partition, count() AS parts
FROM system.parts
WHERE table = 'telemetry_events' AND active = 1
GROUP BY partition
ORDER BY parts DESC
```

**Rule:** Always batch inserts — aim for **1,000 to 100,000 rows per INSERT**. Set up a buffer or queue in your application layer (in-memory list, Kafka consumer that flushes every N rows or every N seconds).

---

### Gotcha 5 — Expecting instant deletes

> **Why this happens:** ClickHouse's core design is **immutable append-only storage** — data parts on disk are never modified after writing. When you run `DELETE ... WHERE`, ClickHouse cannot selectively erase rows from an existing part. Instead, it schedules an async **mutation**: a background job that reads every affected part, filters out the matching rows, and writes completely new parts. On large tables this can take minutes or hours. During that time, the rows still exist and queries still return them.

```sql
-- ❌ Expecting this to be instant:
DELETE FROM demo.telemetry_events WHERE user_id = 'user-99'
-- This merely schedules a background mutation — data is NOT gone yet

-- ✅ Check if the mutation is still running:
SELECT mutation_id, command, is_done, parts_to_do, latest_fail_reason
FROM system.mutations
WHERE table = 'telemetry_events'
ORDER BY create_time DESC LIMIT 5

-- ✅ For GDPR / "right to be forgotten" use cases — plan ahead with a soft-delete flag:
ALTER TABLE demo.telemetry_events ADD COLUMN IF NOT EXISTS is_deleted UInt8 DEFAULT 0

-- Mark as deleted (fast INSERT, not a mutation):
INSERT INTO demo.telemetry_events
SELECT *, 1 AS is_deleted FROM demo.telemetry_events WHERE user_id = 'user-99'
-- Then filter in queries: WHERE is_deleted = 0

-- ✅ Or use a CollapsingMergeTree so -1 sign rows cancel out the original data
```

**Rule:** Think of ClickHouse as a log — you can only append. Plan for soft deletes at schema design time. Only use `DELETE` for infrequent, low-priority operations (not real-time paths).

---

### Gotcha 6 — Distributed table inserts are async

> **Why this happens:** When you INSERT into a Distributed table, the coordinator node (e.g., node1) doesn't send rows directly to shards in the same request — it writes them to a local **on-disk buffer** first and acknowledges your insert immediately. A background thread then forwards the buffered rows to the appropriate shards. If node1 crashes before flushing, those buffered rows can be lost. Also, if you INSERT and immediately SELECT on a shard, you may not see the row yet because the background thread hasn't flushed.

```sql
-- ❌ Insert via Distributed, then immediately query a specific shard:
INSERT INTO cluster_demo.events_distributed VALUES (now(), 'frontend', ...)
-- Row acknowledged, but it's in node1's local buffer

-- Immediately querying node2 directly might return 0 rows:
SELECT count() FROM cluster_demo.events_local  -- on node2 — might miss the row!

-- ✅ Force synchronous delivery to shards (slower but reliable):
SET insert_distributed_sync = 1
INSERT INTO cluster_demo.events_distributed VALUES (...)
-- Now the row is confirmed on the target shard before the INSERT returns

-- ✅ For reading, always query through the Distributed table, not individual nodes:
SELECT count() FROM cluster_demo.events_distributed  -- queries all shards, always consistent
```

**Rule:** Always read via the Distributed table, not directly from individual shard nodes. Use `insert_distributed_sync = 1` only when you need guaranteed write-then-read consistency (e.g., in tests or critical workflows).

---

### Gotcha 7 — `Nullable` columns slow everything down

> **Why this happens:** ClickHouse stores `Nullable(T)` as *two* separate columns on disk: one for the actual values (`T`), and one for a **null bitmap** (1 bit per row indicating whether the value is null). Every read, aggregate, and comparison on a Nullable column must process both columns. Aggregation functions like `sum()`, `count()`, and `avg()` also have to check the null bitmap for every row. This adds overhead everywhere — more disk I/O, more CPU, and the optimizer has fewer opportunities to use SIMD vectorization.

```sql
-- ❌ Avoid Nullable unless NULL is semantically critical:
value    Nullable(Float64)    -- stores 2 columns, slower aggregates
user_id  Nullable(String)     -- adds null bitmap I/O on every query

-- ✅ Use a DEFAULT value to represent "unknown" or "not set":
value    Float64 DEFAULT 0.0   -- 0 means no value; clean and fast
user_id  String  DEFAULT ''    -- empty string means anonymous user

-- ✅ Use a sentinel value when 0 or '' could be valid:
duration_ms  Int32 DEFAULT -1   -- -1 means "duration not recorded"
-- Filter: WHERE duration_ms != -1

-- ✅ Only use Nullable when the difference between NULL and 0 is semantically important:
rating  Nullable(UInt8)
-- WHERE rating IS NULL means "user hasn't rated yet"
-- WHERE rating = 0 means "user rated 0 stars"
-- These are different — Nullable is justified here
```

**Rule:** Default to non-Nullable with a `DEFAULT` expression. Only add `Nullable` when `NULL` and `0`/`''` have genuinely different meanings in your domain.

---

### Gotcha 8 — Filtering on non-prefix ORDER BY columns

> **Why this happens:** ClickHouse uses a **sparse primary index** built from the `ORDER BY` columns. The index stores the minimum and maximum value of each ORDER BY column for every 8,192 rows (a "granule"). When you filter on a column that is the *first* in ORDER BY, ClickHouse can skip entire granules that clearly don't contain your value. But if you filter on a column that is *not the first* in ORDER BY, ClickHouse cannot use the index to skip granules — it must read everything. Think of it like a phone book: you can find "Smith, John" instantly, but finding everyone named "John" requires reading the whole book because it's sorted by last name first.

```sql
-- Table ORDER BY (service, event_type, timestamp)

-- ✅ FAST — filters on first ORDER BY column → index can skip granules:
WHERE service = 'frontend'
-- ClickHouse skips all granules where min(service) > 'frontend' or max(service) < 'frontend'

-- ✅ FAST — filters on first two columns → even more granules skipped:
WHERE service = 'frontend' AND event_type = 'purchase'

-- ❌ SLOW — skips 'service' (first column) → full table scan:
WHERE event_type = 'purchase'
-- ClickHouse CANNOT use the index here — must read all granules

-- ❌ SLOW — 'user_id' is not in ORDER BY at all:
WHERE user_id = 'user-123'
-- Full scan always

-- ✅ Workaround for frequent non-prefix lookups — add a secondary index:
ALTER TABLE demo.telemetry_events
ADD INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 4
-- Bloom filter index allows probabilistic skipping for user_id lookups,
-- at the cost of some extra storage (~4 bytes per user_id per granule)
```

**Rule:** Design your `ORDER BY` with your *most common WHERE clause columns first*. If you routinely filter by a column that isn't in ORDER BY, either add it to ORDER BY (requires table recreation) or add a bloom_filter secondary index.

---




## Module H — Troubleshooting  (Reference)

### "Too many parts" error

**Symptom:** Inserts fail with `Merges are processing significantly slower than inserts`.

**Cause:** Too many small inserts creating too many parts per partition.

**Fix:**
```sql
-- Check current part count:
SELECT partition, count() AS parts
FROM system.parts
WHERE table = 'your_table' AND active = 1
GROUP BY partition HAVING parts > 100
ORDER BY parts DESC

-- Force a merge to reduce part count:
OPTIMIZE TABLE your_table FINAL

-- Long-term fix: batch your inserts (1000+ rows per INSERT)
```

### Query is slow

```sql
-- Step 1: Check if the query used the index (look for 'Granules' skipped):
EXPLAIN indexes = 1
SELECT ... FROM your_table WHERE service = 'frontend'

-- Step 2: Check how many rows/bytes were read:
SELECT read_rows, read_bytes, query_duration_ms
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY event_time DESC LIMIT 5

-- Step 3: If reading too many rows, check your ORDER BY
-- and consider adding more columns to the partition key
```

### Replication is lagging

```sql
-- Check replication queue size (should be 0 or very small):
SELECT table, replica_name, queue_size, last_queue_update
FROM system.replicas
WHERE database = 'cluster_demo'

-- If queue is stuck, check exceptions:
SELECT database, table, last_exception, num_tries
FROM system.replication_queue
WHERE last_exception != ''
ORDER BY create_time DESC LIMIT 10
```

### ClickHouse Keeper is down

**Symptoms:** `ReplicatedMergeTree` tables become read-only. INSERT errors mentioning ZooKeeper.

**Fix:**
```bash
docker compose restart clickhouse-keeper
# Wait 30 seconds, then check:
curl http://localhost:8124/ping   # should return Ok.
```

### Out of disk space

```sql
-- Check table sizes:
SELECT table, formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts WHERE active = 1
GROUP BY table ORDER BY sum(bytes_on_disk) DESC

-- Force TTL expiry (drops old partitions immediately):
ALTER TABLE demo.app_logs MATERIALIZE TTL

-- Drop specific partitions manually:
ALTER TABLE demo.app_logs DROP PARTITION '202301'
```

---

## Module I — Capstone Project  ⏱ 45 min

> Build a mini URL-shortener analytics pipeline from scratch.

### What you'll build

A table that tracks every click on a short URL, with:
- Click volume by URL and hour
- Geographic breakdown
- Device type breakdown
- Deduplication (same user clicking same URL in 5 minutes counts once)

### Step 1 — Create the events table

In the SQL Playground, run:

```sql
CREATE TABLE IF NOT EXISTS demo.url_clicks
(
  timestamp   DateTime,
  short_code  LowCardinality(String),    -- e.g. 'abc123'
  user_id     String,
  country     LowCardinality(String),
  device_type LowCardinality(String),   -- mobile / desktop / tablet
  referrer    LowCardinality(String),
  duration_ms UInt32 DEFAULT 0
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (short_code, timestamp)
TTL timestamp + INTERVAL 365 DAY
```

### Step 2 — Seed some data

```sql
INSERT INTO demo.url_clicks SELECT
  now() - toIntervalSecond(rand() % 86400)  AS timestamp,
  ['abc123','xyz789','def456','ghi012'][rand() % 4 + 1] AS short_code,
  concat('user-', toString(rand() % 500))       AS user_id,
  ['US','UK','CA','AU','DE','FR','JP'][rand() % 7 + 1] AS country,
  ['mobile','desktop','tablet'][rand() % 3 + 1]         AS device_type,
  ['google','twitter','direct','email'][rand() % 4 + 1]  AS referrer,
  rand() % 5000                                          AS duration_ms
FROM numbers(10000)
```

### Step 3 — Basic analytics queries

```sql
-- Clicks per short URL (last 24h):
SELECT short_code, count() AS clicks, uniq(user_id) AS unique_clicks
FROM demo.url_clicks
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY short_code ORDER BY clicks DESC

-- Hourly click trend for a specific URL:
SELECT toStartOfHour(timestamp) AS hour, count() AS clicks
FROM demo.url_clicks
WHERE short_code = 'abc123'
GROUP BY hour ORDER BY hour

-- Geographic breakdown:
SELECT country, count() AS clicks,
       round(count() / sum(count()) OVER () * 100, 1) AS pct
FROM demo.url_clicks
GROUP BY country ORDER BY clicks DESC

-- Device breakdown:
SELECT device_type, count() AS clicks
FROM demo.url_clicks
GROUP BY device_type ORDER BY clicks DESC
```

### Step 4 — Add deduplication (ReplacingMergeTree)

Unique clicks: a user clicking the same URL twice within 5 minutes counts as one.

```sql
-- Create a deduplicated unique-clicks table:
CREATE TABLE IF NOT EXISTS demo.url_unique_clicks
(
  short_code LowCardinality(String),
  user_id    String,
  window_start DateTime,   -- 5-minute bucket
  country    LowCardinality(String),
  device_type LowCardinality(String),
  version    UInt64        -- ReplacingMergeTree key
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (short_code, user_id, window_start)

-- Seed it (one row per user per URL per 5-minute window):
INSERT INTO demo.url_unique_clicks
SELECT
  short_code,
  user_id,
  toStartOf5Minutes(timestamp) AS window_start,
  country,
  device_type,
  toUnixTimestamp(max(timestamp)) AS version
FROM demo.url_clicks
GROUP BY short_code, user_id, window_start, country, device_type

-- Query unique clicks (use FINAL for exact deduplication):
SELECT short_code, count() AS unique_clicks
FROM demo.url_unique_clicks FINAL
GROUP BY short_code ORDER BY unique_clicks DESC
```

### Step 5 — Add pre-aggregation (Materialized View)

```sql
-- Auto-aggregate hourly stats as data arrives:
CREATE MATERIALIZED VIEW IF NOT EXISTS demo.url_hourly_stats
ENGINE = SummingMergeTree()
ORDER BY (short_code, country, device_type, hour)
AS
SELECT
  toStartOfHour(timestamp) AS hour,
  short_code,
  country,
  device_type,
  count()     AS clicks,
  uniq(user_id) AS unique_users
FROM demo.url_clicks
GROUP BY hour, short_code, country, device_type

-- Query the MV (fast pre-aggregated):
SELECT short_code, sum(clicks) AS total, sum(unique_users) AS approx_unique
FROM demo.url_hourly_stats
WHERE hour >= now() - INTERVAL 24 HOUR
GROUP BY short_code ORDER BY total DESC
```

### Step 6 — Self-assessment

You've completed the capstone if you can answer these:

- [ ] Why did you use `LowCardinality` on `short_code` and `country`?
- [ ] Why is `ORDER BY (short_code, timestamp)` a good choice here?
- [ ] What would happen if you had 1 INSERT per click instead of batches?
- [ ] Why does the Materialized View use `SummingMergeTree` instead of `MergeTree`?
- [ ] If you had 100 billion clicks, how would you shard this table?

---

## Cheat Sheet — Quick Reference

### Time functions
```sql
now()                            -- current DateTime
today()                          -- current Date
toStartOfHour(ts)                -- bucket to hour
toStartOfDay(ts)                 -- bucket to day
toStartOfWeek(ts)                -- bucket to week
toStartOfMonth(ts)               -- bucket to month
toYYYYMM(ts)                     -- YYYYMM integer
toStartOf5Minutes(ts)            -- bucket to 5-min window
now() - INTERVAL 24 HOUR         -- 24 hours ago
dateDiff('second', ts1, ts2)     -- difference in seconds
formatDateTime(ts, '%Y-%m-%d')   -- format as string
```

### Aggregate functions
```sql
count()                          -- row count
sum(col)                         -- total
avg(col)                         -- average
min(col) / max(col)              -- extremes
uniq(col)                        -- approx distinct (~2% error)
uniqExact(col)                   -- exact distinct (slower)
quantile(0.95)(col)              -- 95th percentile
quantiles(0.5,0.95,0.99)(col)    -- multiple percentiles at once
countIf(condition)               -- conditional count
sumIf(col, condition)            -- conditional sum
groupArray(col)                  -- collect values into array
groupUniqArray(col)              -- collect unique values into array
```

### Engine decision tree
```
Appending time-series data?
  └─▶ MergeTree

Need to keep only the latest version per key?
  └─▶ ReplacingMergeTree

Need automatic SUM aggregation per key?
  └─▶ SummingMergeTree

Need pre-aggregated HLL/quantiles via Materialized View?
  └─▶ AggregatingMergeTree

Need soft deletes / corrections via ±1 sign column?
  └─▶ CollapsingMergeTree

Need any of the above on multiple nodes with auto-sync?
  └─▶ Replicated* (e.g., ReplicatedMergeTree) + Keeper

Need to query across all shards as one table?
  └─▶ Distributed table on top of any Replicated* engine
```

### Performance rules
| Rule | Reason |
|------|--------|
| Filter on `ORDER BY` prefix columns | Uses sparse index, skips parts |
| `PARTITION BY` on time column | Partition pruning skips directories |
| `LowCardinality(String)` for < 10k distinct values | Dictionary encoding, 3–5× speedup |
| Batch inserts (1000+ rows) | One part per INSERT, not one per row |
| `FINAL` with ReplacingMergeTree | Forces synchronous dedup |
| `sum(col * sign)` with CollapsingMergeTree | Gets net value after corrections |
| Avoid `SELECT *` on wide tables | Only read needed columns |
| Avoid `Nullable` when possible | Null bitmap adds overhead |

---

## Further Reading

| Resource | URL |
|----------|-----|
| ClickHouse documentation | https://clickhouse.com/docs |
| MergeTree engine family | https://clickhouse.com/docs/engines/table-engines/mergetree-family |
| ClickHouse Keeper | https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper |
| Distributed table engine | https://clickhouse.com/docs/engines/table-engines/special/distributed |
| Materialized Views guide | https://clickhouse.com/docs/materialized-view |
| System tables reference | https://clickhouse.com/docs/operations/system-tables |
| SQL functions reference | https://clickhouse.com/docs/sql-reference/functions |
| ClickHouse Play (online sandbox) | https://play.clickhouse.com |
| ClickHouse blog (real-world use cases) | https://clickhouse.com/blog |

---

*ClickHouse Explorer training guide · Updated Feb 2026 · Start the app: `bash start.sh`*
