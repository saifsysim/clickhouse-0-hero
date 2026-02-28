# 13 Common ClickHouse Mistakes — Interactive Guide 🔥

> This guide is built into the **ClickHouse Explorer** application as an interactive learning experience.  
> Every mistake has a live **▶ Run ❌ Wrong / ▶ Run ✅ Fixed** demo that executes real queries against your local ClickHouse instance so you can *feel* the difference — not just read about it.

---

## How the Interactive Demos Work

Each mistake card in the **"13 Mistakes"** tab has three buttons:

| Button | What it does |
|---|---|
| **▶ Run ❌ Wrong** | Executes the bad pattern against real sample data. Writes results to the **red (left) pane**. |
| **▶ Run ✅ Fixed** | Executes the corrected pattern. Writes results to the **green (right) pane** for direct side-by-side comparison. |
| **↺ Reset** *(stateful demos only)* | Drops any temporary tables created during the demo so you can run it again cleanly. |

The panes update live — you see real part counts, real query timings, real `EXPLAIN` output, and real byte sizes from `system.columns`.

---

## The 13 Mistakes

### ① Too Many Parts *(Ingestion)*

**Symptom:** `DB::Exception: Too many parts (N in total)`

**The Mistake:**  
Every `INSERT` in ClickHouse creates a new *part* on disk. Three common triggers:
- **High-cardinality partition key** — `PARTITION BY toDateTime(ts)` creates one folder per second.
- **Tiny row-by-row inserts** — a client that fires `INSERT` per event instead of batching.
- **Too many Materialized Views** — each MV multiplies the part pressure.

**What goes wrong:**  
Queries slow down as ClickHouse evaluates more index files. Above 300 active parts ClickHouse starts printing warnings; above ~1,000 it can refuse further writes.

**The Fix:**
```sql
-- ✅ Good partition key: < 1000 unique values
CREATE TABLE events (ts DateTime, ...) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)   -- ~12 values/year instead of millions
ORDER BY (service, ts);

-- ✅ Batch inserts (10k–100k rows per INSERT)
-- OR use async inserts for streaming:
INSERT INTO events SETTINGS async_insert=1, wait_for_async_insert=1
VALUES (...);
```

**🔬 Live Demo:** Run ❌ Wrong inserts 15 rows one at a time → creates **15 parts**.  
Run ✅ Fixed inserts all 15 as one batch → creates **1 part**. Same data, 15× fewer files.

---

### ② Going Horizontal Too Early *(Ops)*

**Symptom:** Slow queries on a cluster that runs fine on a single beefy node.

**The Mistake:**  
Adding more shards before saturating a single machine. ClickHouse is designed to maximise use of all cores and memory on one host. A cluster adds network overhead, coordination complexity, and cross-shard query fan-out that often hurts more than it helps on <100 GB datasets.

**The Fix:**
1. Max out vertical resources first (CPU, RAM, NVMe storage).
2. Profile with `EXPLAIN PIPELINE` and `system.query_log`.
3. Only shard when a single node genuinely can't keep up.

> *The Cluster & Replication tab in this app shows when a cluster genuinely helps.*

---

### ③ Mutation Pain *(Ops)*

**Symptom:** `ALTER TABLE ... UPDATE/DELETE` queries run for hours and block reads.

**The Mistake:**  
`UPDATE` and `DELETE` in ClickHouse are called *mutations* — they rewrite entire parts on disk. Running frequent mutations on large tables is extremely I/O intensive.

**The Fix:**
```sql
-- ✅ Use lightweight UPDATE (ClickHouse 23.3+, Cloud)
ALTER TABLE events UPDATE status = 'cancelled' WHERE order_id = 42
SETTINGS mutations_sync = 0;   -- async, non-blocking

-- ✅ Better: design to avoid updates (immutable event log)
-- ✅ Or use ReplacingMergeTree for upsert patterns
```

For truly mutable data, consider `ReplacingMergeTree(version)` with `SELECT ... FINAL`.

---

### ④ Mishandling Semi-Structured Data *(Schema)*

**Symptom:** Constantly running `JSONExtract` on every query, killing performance.

**The Mistake:**  
Storing all dynamic fields in a single `String` column and parsing JSON at query time scans the entire column on every query and prevents any vectorised execution.

**The Fix:**
```sql
-- ✅ Use native complex types for known fields
CREATE TABLE events (
    id    UInt64,
    props Map(String, String),   -- for dynamic KV pairs
    tags  Array(String),          -- for list fields
    meta  JSON                    -- for truly unknown structure (24.3+)
) ENGINE = MergeTree() ORDER BY id;
```

Use `JSONExtractString` only for one-off exploration queries, not production dashboards.

---

### ⑤ Overuse of Nullable *(Schema)*

**Symptom:** Tables with many `Nullable(String)` / `Nullable(Int64)` columns are larger and slower than expected.

**The Mistake:**  
Every `Nullable` column stores a hidden **null-map bitmap file** alongside the data column. This doubles the number of disk reads for the column and prevents some ClickHouse optimisations.

**The Fix:**
```sql
-- ❌ Wrong
CREATE TABLE users (
    email   Nullable(String),
    country Nullable(String),
    age     Nullable(Int32)
) ENGINE = MergeTree() ORDER BY id;

-- ✅ Fixed — use sentinel / default values
CREATE TABLE users (
    email   String DEFAULT '',
    country LowCardinality(String) DEFAULT 'unknown',
    age     Int32 DEFAULT 0
) ENGINE = MergeTree() ORDER BY id;

-- Filter out unknowns at query time:
SELECT * FROM users WHERE email != '';
```

**🔬 Live Demo:** Creates 2,000 rows in both schemas → compares compressed byte sizes from `system.columns`. The `DEFAULT` version is consistently smaller because there's no null-map overhead, and `LowCardinality` adds dictionary compression on top.

---

### ⑥ Insert-Time Deduplication Surprise *(Ingestion)*

**Symptom:** After a retry on network failure, you have duplicate rows. Or conversely, you deleted rows by accident because ClickHouse thought it was a retry.

**The Mistake:**  
ClickHouse's insert deduplication (controlled by `non_replicated_deduplication_window` and `replicated_deduplication_window`) only works on **ReplicatedMergeTree** tables. On plain `MergeTree`, ClickHouse has **no dedup window by default** — retrying the exact same block will insert duplicates.

**The Fix:**
```sql
-- ✅ Option 1: Use ReplacingMergeTree for idempotent upserts
CREATE TABLE orders (
    id  UInt64,
    payload String,
    ver UInt64              -- monotonically increasing version
) ENGINE = ReplacingMergeTree(ver)
ORDER BY id;

-- Retry the same INSERT safely — ReplacingMergeTree keeps highest ver
-- Use SELECT ... FINAL to force dedup at read time:
SELECT * FROM orders FINAL;

-- ✅ Option 2: Design idempotent pipelines (include a hash/checksum per block)
-- ✅ Option 3: Use ReplicatedMergeTree — gets dedup window for free
```

**🔬 Live Demo:**  
**Run ❌ Wrong** inserts 3 rows, retries the same 3 rows → count shows **6** (duplicates!).  
**Run ✅ Fixed** creates a `ReplacingMergeTree(ver)`, inserts + updates → shows raw "5 rows without FINAL" vs "3 rows with FINAL" (correct dedup).

---

### ⑦ Poor Primary Key Selection *(Schema)*

**Symptom:** Queries are slow even though the table isn't huge. `EXPLAIN` shows all granules being read.

**The Mistake:**  
The `ORDER BY` clause in ClickHouse **is** the primary key — it determines which granules can be skipped. Filtering on columns not in `ORDER BY`, or putting high-cardinality columns first, means ClickHouse has to read everything.

**The Rule:** Order columns in `ORDER BY` from **lowest cardinality → highest cardinality** for maximum skip efficiency.

```sql
-- ❌ Wrong — high-cardinality first, low-cardinality last
ORDER BY (user_id, timestamp)   -- can't skip by service or event_type

-- ✅ Fixed — low-cardinality first
ORDER BY (service, event_type, timestamp)
-- Now: WHERE service = 'payment' skips everything else
-- And: WHERE service = 'payment' AND event_type = 'checkout' skips even more
```

**🔬 Live Demo:**  
**Run ❌ Wrong** runs `WHERE user_id = 'user-42'` — shows EXPLAIN with all granules read.  
**Run ✅ Fixed** runs `WHERE service = 'frontend'` — shows EXPLAIN with index skip, far fewer granules.

---

### ⑧ Overuse of Data Skipping Indices *(Query)*

**Symptom:** INSERTs became slow after adding skip indices. Queries didn't get faster.

**The Mistake:**  
Data skipping indices (bloom filters, minmax, set) are appealing but have a real insert-time cost — ClickHouse must compute and store the index for every new part. They also only help when the indexed column has high selectivity AND values are physically clustered together.

**The Fix:**  
First exhaust these alternatives in order:
1. Improve the `ORDER BY` to cover the filter column.
2. Use `PREWHERE` (ClickHouse's lazy-evaluation pushdown) instead.
3. Use a projection that includes the column in its own sort order.
4. **Only then** add a skip index — and measure the trade-off.

```sql
-- Use PREWHERE for a cheap filter path before the main read:
SELECT * FROM events
PREWHERE service = 'payment'   -- evaluated before reading all columns
WHERE duration_ms > 500;
```

---

### ⑨ LIMIT Doesn't Always Short-Circuit *(Query)*

**Symptom:** `SELECT ... GROUP BY x ORDER BY x LIMIT 1` takes as long as `SELECT ... GROUP BY x ORDER BY x` with no LIMIT.

**The Mistake:**  
ClickHouse must build the full aggregation hash table **before** it can apply `LIMIT`. The LIMIT only fires after all rows are aggregated.

**The Fix:**
```sql
-- ✅ If ORDER BY matches your table's ORDER BY, enable in-order aggregation:
SELECT service, event_type, count()
FROM telemetry_events
GROUP BY service, event_type
ORDER BY service
LIMIT 1
SETTINGS optimize_aggregation_in_order = 1;
-- ClickHouse stops after filling 1 bucket — reads far fewer rows at scale.
```

**🔬 Live Demo:**  
**Run ❌ Wrong** runs the query with default settings — shows elapsed ms.  
**Run ✅ Fixed** adds `optimize_aggregation_in_order = 1` — shows the timing difference and confirms the same result row is returned.

---

### ⑩ Readonly Tables *(Ops)*

**Symptom:** `DB::Exception: Table is in readonly mode`.

**The Cause:**  
In replicated setups, a ClickHouse node goes read-only when it loses its connection to **ClickHouse Keeper** (or ZooKeeper). It can't confirm quorum for writes, so it refuses them to avoid split-brain.

**The Fix:**
```sql
-- 1. Check Keeper connectivity:
SELECT * FROM system.zookeeper WHERE path = '/clickhouse';

-- 2. Check replica status:
SELECT database, table, is_readonly, zookeeper_exception
FROM system.replicas WHERE is_readonly = 1;

-- 3. If Keeper is healthy, trigger re-attach:
SYSTEM RESTART REPLICA db.table;
-- or
DETACH TABLE db.table; ATTACH TABLE db.table;
```

Prevention: run 3 Keeper nodes (odd number for quorum), deploy ClickHouse Keeper on separate hosts from ClickHouse servers.

---

### ⑪ Memory Limit Exceeded for Query *(Query)*

**Symptom:** `DB::Exception: Memory limit (total) exceeded: would use X, maximum: Y`

**The Mistake:**  
Large joins (right-hand table in memory), high-cardinality `GROUP BY`, or `groupArray` on millions of keys will exceed the default per-query memory limit.

**The Fix:**
```sql
-- ✅ Enable disk-spill for large GROUP BY:
SET max_bytes_before_external_group_by = 10000000000;  -- 10 GB

-- ✅ Enable disk-spill for large ORDER BY:
SET max_bytes_before_external_sort = 10000000000;

-- ✅ Small-table-right rule for JOINs:
SELECT * FROM large_events e
JOIN small_users u ON e.user_id = u.id;   -- small table always on RIGHT

-- ✅ Per-user memory quota (in users.xml or SQL):
ALTER USER analyst SETTINGS max_memory_usage = 5000000000;
```

**🔬 Live Demo:**  
**Run ❌ Wrong** runs `GROUP BY user_id` with `groupArray` and no limits — shows raw memory from `system.query_log`.  
**Run ✅ Fixed** adds `max_bytes_before_external_group_by + max_memory_usage` — shows the query completes safely with controlled memory.

---

### ⑫ Materialized View Pitfalls *(Mat. Views)*

**Symptom:** MV target table has far fewer rows than the source table. Or: inserts got dramatically slower after adding MVs.

**The Mistake — 4 common ones:**

**a)** MVs only fire on **new INSERT blocks** — they do not backfill historical data.  
**b)** Attaching 50+ MVs to a single table — each adds insert overhead and part pressure.  
**c)** Using CPU-heavy state functions (`quantileState`) on every insert at high throughput.  
**d)** Schema mismatch between the MV `SELECT` and the `AggregatingMergeTree` target (column order matters, not names).

**The Fix:**
```sql
-- ✅ After creating an MV on existing data, always backfill:
INSERT INTO mv_target_table
SELECT ...aggregation...
FROM source_table
WHERE date >= '2024-01-01';   -- optionally chunk by date range

-- ✅ Match aliases to target column names exactly:
CREATE MATERIALIZED VIEW mv_summary TO summary_table AS
SELECT
    toDate(ts)          AS day,       -- must match summary_table.day
    service             AS service,
    countState()        AS cnt_state  -- must match summary_table.cnt_state
FROM events GROUP BY day, service;

-- ✅ Enable parallel MV processing (Cloud / 24.3+):
SET parallel_view_processing = 1;
```

**🔬 Live Demo:**  
**Run ❌ Wrong** creates a new MV after 60,000 rows already exist → shows **0 rows captured**.  
**Run ✅ Fixed** runs the backfill `INSERT INTO ... SELECT` → shows the MV target instantly has **60,000 events** with a per-service breakdown.  
**↺ Reset** drops the demo MV and target table so you can run the lesson again.

---

### ⑬ Experimental Features in Production *(Ops)*

**Symptom:** Feature was removed or its API changed in the next ClickHouse release, breaking production.

**The Mistake:**  
Using `SET allow_experimental_...` features in production. These are community prototypes — their APIs can change, they may have data correctness bugs, and they receive no official support SLA.

**The Fix — Maturity levels:**

| Level | Setting prefix | Status |
|---|---|---|
| 🟢 **Production-ready** | *(none needed)* | Fully supported, stable API |
| 🟡 **Beta** | `SET allow_beta_...` | On path to production, officially supported |
| 🔴 **Experimental** | `SET allow_experimental_...` | Do **NOT** use in production |

Always check the [ClickHouse feature maturity page](https://clickhouse.com/docs/beta-and-experimental-features) before adopting any new feature.

---

## Quick Reference Card

| # | Mistake | Category | Has Live Demo |
|---|---|---|---|
| 01 | Too Many Parts | 🚢 Ingestion | ✅ Run ❌ Wrong / ✅ Fixed / ↺ Reset |
| 02 | Going Horizontal Too Early | ⚙️ Ops | — |
| 03 | Mutation Pain | ⚙️ Ops | — |
| 04 | Mishandling Semi-Structured Data | 🗂 Schema | — |
| 05 | Overuse of Nullable | 🗂 Schema | ✅ Run ❌ Wrong / ✅ Fixed / ↺ Reset |
| 06 | Insert-Time Deduplication Surprise | 🚢 Ingestion | ✅ Run ❌ Wrong / ✅ Fixed |
| 07 | Poor Primary Key Selection | 🗂 Schema | ✅ Run ❌ Wrong / ✅ Fixed |
| 08 | Overuse of Data Skipping Indices | 🔍 Query | — |
| 09 | LIMIT Doesn't Always Short-Circuit | 🔍 Query | ✅ Run ❌ Wrong / ✅ Fixed |
| 10 | Readonly Tables | ⚙️ Ops | — |
| 11 | Memory Limit Exceeded | 🔍 Query | ✅ Run ❌ Wrong / ✅ Fixed |
| 12 | Materialized View Pitfalls | 📐 Mat. Views | ✅ Run ❌ Wrong / ✅ Fixed / ↺ Reset |
| 13 | Experimental Features in Production | ⚙️ Ops | — |

---

## Further Reading

- [ClickHouse blog: 13 common getting-started issues](https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse)
- [system.parts reference](https://clickhouse.com/docs/en/operations/system-tables/parts)
- [Primary keys & ORDER BY design guide](https://clickhouse.com/docs/en/optimize/sparse-primary-indexes)
- [Materialized Views deep dive](https://clickhouse.com/docs/en/guides/developer/cascading-materialized-views)
- [Memory settings reference](https://clickhouse.com/docs/en/operations/settings/settings#max_memory_usage)
