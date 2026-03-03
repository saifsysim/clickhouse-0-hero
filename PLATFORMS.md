# Real-World Scenarios & Platform Comparisons 🌍

> **When should you use ClickHouse — and which engine should you pick?**  
> This guide walks through real production scenarios you can emulate in the ClickHouse Explorer app, and compares how ClickHouse's unique engine system stacks up against Snowflake, Databricks, and Apache Pinot.

---

## Part 1 — Real-World Scenarios You Can Emulate

Each scenario below maps to a real company use case, the ClickHouse engine that fits best, and the demo tables in this app you can query right now.

---

### Scenario 1 — Product Analytics Platform
**"How many users triggered checkout in the last 7 days, broken down by country and device?"**

> **Real companies:** PostHog, Mixpanel, Amplitude, Heap

**Why ClickHouse:** Product analytics is a near-perfect fit. You have a single append-only event stream (clicks, page views, conversions) with dozens of dimensions to slice. ClickHouse's columnar layout means you read only the columns you filter on — `event_type`, `country`, `device` — without touching `properties` or `session_id`.

**Engine to use:** `MergeTree` ordered by `(user_id, event_type, timestamp)`

**Emulate in this app:**
```sql
-- Run in the SQL Playground tab
SELECT
    event_type,
    count()                              AS total_events,
    countDistinct(user_id)               AS unique_users,
    avg(duration_ms)                     AS avg_duration_ms,
    quantile(0.95)(duration_ms)          AS p95_ms
FROM telemetry_events
WHERE timestamp >= now() - INTERVAL 7 DAY
GROUP BY event_type
ORDER BY total_events DESC;
```

**Key ClickHouse features at work:**
- `countDistinct` uses **HyperLogLog** approximation for billion-row speed
- `quantile()` runs in a single pass with a mergeable sketch
- Columnar reads: `timestamp` and `event_type` columns only — not the wide `properties` column

---

### Scenario 2 — Observability & Log Analytics
**"Show me all ERROR logs from the payment service in the last 1 hour, with full-text search on the message"**

> **Real companies:** Cloudflare (uses ClickHouse for 1B+ rows/day of DNS query logs), Uber (internal observability), Sentry

**Why ClickHouse:** Logs are immutable, append-only, and need fast filter+aggregate at high cardinality. ClickHouse's TTL engine automatically expires old logs without manual jobs. Full-text search via `position()`, `like()`, or the `tokenbf_v1` skip index handles log grep use cases.

**Engine to use:** `MergeTree` with `TTL timestamp + INTERVAL 30 DAY DELETE`

**Emulate in this app:**
```sql
-- Error rate by service over time (Structured Logging tab replicates this)
SELECT
    toStartOfHour(timestamp)  AS hour,
    service,
    level,
    count()                   AS log_count
FROM app_logs
WHERE level = 'ERROR'
  AND timestamp >= now() - INTERVAL 24 HOUR
GROUP BY hour, service, level
ORDER BY hour DESC, log_count DESC;

-- Full-text search for a specific error pattern
SELECT timestamp, service, message
FROM app_logs
WHERE position(message, 'connection refused') > 0
ORDER BY timestamp DESC
LIMIT 20;
```

**Key insight:** Unlike Elasticsearch (which indexes every token), ClickHouse scans compressed columns. For < 100B rows this is faster and 5–10× cheaper to store.

---

### Scenario 3 — Real-Time Billing & Cost Metering
**"How much has each team spent on compute this month, with running totals updated every minute?"**

> **Real companies:** AWS Cost Explorer, Snowflake credit metering, Stripe usage billing

**Why ClickHouse:** Usage records arrive as a stream of small increments (CPU seconds, API calls, data transferred). `SummingMergeTree` automatically sums matching keys on every background merge — you never run a slow full-table `SUM()` again.

**Engine to use:** `SummingMergeTree(cost_usd)` ordered by `(team, service, date)`

**Emulate in this app:**
```sql
-- Cost & Usage tab uses cost_usage (SummingMergeTree)
-- Background merges have already pre-summed rows with matching keys:
SELECT
    team,
    service,
    sum(cost_usd)   AS total_spend,  -- SummingMergeTree pre-sums these
    sum(quantity)   AS total_units
FROM cost_usage
WHERE date >= toStartOfMonth(today())
GROUP BY team, service
ORDER BY total_spend DESC;
```

**Key insight:** After background merges, `SELECT sum(cost_usd) GROUP BY team` may scan only 1 row per team instead of millions of raw records. The pre-aggregation happens at write time, not query time.

---

### Scenario 4 — Ad Tech: Impression & Click Attribution
**"Count unique ad impressions and click-through rate per campaign, at sub-second latency, for a live dashboard"**

> **Real companies:** Yandex (ClickHouse was built here for ad analytics), ByteDance, Criteo

**Why ClickHouse:** Ad tech is ClickHouse's birth use case. Billions of impression events, strict sub-second query SLAs for live dashboards, and counting distinct user IDs at scale (HyperLogLog). `AggregatingMergeTree` + Materialized Views pre-aggregate impressions into hourly buckets at ingest time.

**Engine to use:** `AggregatingMergeTree` + `countState()` / `uniqState()` in a Materialized View

**Emulate in this app:**
```sql
-- The telemetry_hourly_agg table is an AggregatingMergeTree MV
-- It pre-aggregates telemetry_events at insert time
SELECT
    toDate(hour)                              AS date,
    service,
    sum(event_count)                          AS total_events,
    round(avg(avg_duration_ms_state), 2)      AS avg_ms
FROM telemetry_hourly_agg
WHERE hour >= now() - INTERVAL 7 DAY
GROUP BY date, service
ORDER BY date DESC, total_events DESC;
```

---

### Scenario 5 — IoT & Time-Series Sensor Data
**"Store 100k sensor readings per second from 50,000 devices, and query the p99 temperature per device over any 24h window"**

> **Real companies:** Bosch, VW (telematics), smart grid operators, SCADA systems

**Why ClickHouse:** Sensor data is the purest time-series workload — always-increasing timestamps, high write throughput, range queries on time + device ID. ClickHouse's `ORDER BY (device_id, timestamp)` clusters data physically, making range scans blazing fast.

**Engine to use:** `MergeTree` ordered by `(device_id, timestamp)`, partitioned by `toYYYYMM(timestamp)`

**Emulate in this app:**
```sql
-- Simulate IoT with telemetry_events — treat service as device_id
SELECT
    service                               AS device_id,
    toStartOfHour(timestamp)              AS hour,
    avg(duration_ms)                      AS avg_reading,
    quantile(0.99)(duration_ms)           AS p99_reading,
    min(duration_ms)                      AS min_reading,
    max(duration_ms)                      AS max_reading
FROM telemetry_events
GROUP BY device_id, hour
ORDER BY device_id, hour DESC
LIMIT 50;
```

---

### Scenario 6 — Financial Risk: Trade Book with Corrections
**"Record every trade. Allow corrections (e.g. tick size fix). Always show the current correct position"**

> **Real companies:** Trading desks, market-making firms, crypto exchanges

**Why ClickHouse:** Financial records are immutable by regulation, but corrections happen. `CollapsingMergeTree` handles this elegantly: a +1 sign row inserts, a -1 sign row cancels it. The background merge collapses them, leaving only the net position.

**Engine to use:** `CollapsingMergeTree(sign)` ordered by `(account_id, trade_id)`

**Emulate in this app:**
```sql
-- budget_limits uses CollapsingMergeTree(sign)
-- Positive sign = current value; negative sign = cancels previous
SELECT
    team,
    service,
    sum(sign * monthly_budget_usd)    AS net_budget,
    sum(sign * alert_threshold_usd)   AS net_threshold
FROM budget_limits
GROUP BY team, service
HAVING net_budget > 0   -- filter out collapsed rows
ORDER BY net_budget DESC;
```

---

### Scenario 7 — Deduplication Pipeline (Kafka Exactly-Once)
**"Events arrive from Kafka. Due to at-least-once delivery, duplicates are common. Ensure idempotent storage"**

> **Real companies:** Any event streaming pipeline — Stripe, Lyft, DoorDash

**Why ClickHouse:** `ReplacingMergeTree(version)` accepts duplicate writes safely. The highest `version` wins after merge. `SELECT ... FINAL` forces dedup at read time if you can't wait for background merge.

**Engine to use:** `ReplacingMergeTree(version)` ordered by `(event_id)`

**Emulate in this app:**
```sql
-- error_summary uses ReplacingMergeTree
-- Insert the same key twice — only the latest version survives after FINAL
SELECT
    error_code,
    service,
    sum(count)       AS total_occurrences,
    max(last_seen)   AS last_seen
FROM error_summary FINAL
GROUP BY error_code, service
ORDER BY total_occurrences DESC;
```

---

## Part 2 — ClickHouse Engines vs Other Platforms

ClickHouse's superpower is its **pluggable engine system** — you choose the write/merge semantics per table, not just the storage format. Here's how each engine maps to patterns on Snowflake, Databricks, and Apache Pinot.

---

### Engine 1: MergeTree (Core Columnar Storage)

The foundation. Append-only, sorted by `ORDER BY`, background-merged, columnar compressed.

| Platform | Equivalent | Key difference |
|---|---|---|
| **ClickHouse MergeTree** | — | Sorted on write, granule-based sparse index, vectorised SIMD reads |
| **Snowflake** | Default table (micro-partitions) | Automatic micro-partition pruning; no user-controlled sort; warehouse must be running for queries |
| **Databricks Delta Lake** | Delta table (Parquet + transaction log) | ACID transactions, Z-ordering for multi-dimensional clustering; Photon engine for vectorised reads; cloud-native storage |
| **Apache Pinot** | Offline segment + Real-time segment | Kafka-native ingest; segments immutable post-commit; designed for user-facing latency < 100ms |

**When to pick ClickHouse MergeTree over the others:**
- You need **sub-second** queries on 100M–10B rows without a managed warehouse
- You control the server and want to tune `ORDER BY` precisely
- Cost matters — ClickHouse is pay-for-compute, not pay-per-query

---

### Engine 2: SummingMergeTree (Auto-Aggregating Counters)

Sums numeric columns with the same `ORDER BY` key during background merges. Writes are raw increments; reads see pre-summed totals.

| Platform | Equivalent | Key difference |
|---|---|---|
| **ClickHouse SummingMergeTree** | — | Aggregation happens at **merge time** (write-side), not query time |
| **Snowflake** | Materialized View + INCREMENTAL REFRESH | MV refresh is scheduled/manual; Snowflake charges credits for MV maintenance |
| **Databricks** | Delta Live Tables (DLT) streaming aggregation | DLT is a pipeline framework, not a storage engine; requires Spark infrastructure |
| **Apache Pinot** | Aggregation index (pre-aggregate at segment level) | Pinot's metrics ingest can sum/count at ingest time; less flexible on the key definition |

**Real-world impact:**  
A billing table with 1M raw rows per day merges down to ~100 aggregated rows per (team, service, date). Your `SELECT sum(cost) GROUP BY team` goes from reading 365M rows/year to reading ~36,500.

---

### Engine 3: AggregatingMergeTree (Partial State Pre-Aggregation)

Stores **aggregation states** (intermediate results like HyperLogLog sketches, quantile digests) rather than raw values. Materialized Views feed into it automatically.

| Platform | Equivalent | Key difference |
|---|---|---|
| **ClickHouse AggregatingMergeTree** | — | Native partial-state functions (`countState`, `uniqState`, `quantileState`) merged transparently |
| **Snowflake** | Dynamic Tables (2024+) | Incremental refresh available but limited to simple aggregations; no native sketch merging |
| **Databricks** | Structured Streaming + foreachBatch | Sketch merging possible via libraries; complex to set up; no native storage-layer integration |
| **Apache Pinot** | Star-tree index | Star-tree pre-computes aggregations at multiple granularities at segment build time; excellent for dashboards |

**Key insight:**  
For dashboard queries (`count distinct users`, `p95 latency`), AggregatingMergeTree + Materialized Views at the ClickHouse layer eliminates the query-time cost entirely. Pinot's star-tree index does the same thing but is more opinionated about query shapes.

---

### Engine 4: ReplacingMergeTree (Upserts / Deduplication)

Keeps the row with the highest version per `ORDER BY` key. Enables idempotent writes from at-least-once pipelines.

| Platform | Equivalent | Key difference |
|---|---|---|
| **ClickHouse ReplacingMergeTree** | — | Eventual consistency (dedup on merge); `FINAL` forces immediate dedup |
| **Snowflake** | `MERGE INTO` (ACID) | Immediate, strongly consistent upsert; slower at scale due to MVCC overhead |
| **Databricks Delta** | `MERGE INTO` (ACID, Z-ordering) | Best-in-class for upsert workloads; Delta's transaction log is the gold standard for ACID analytics |
| **Apache Pinot** | Upsert table type (real-time only) | Sub-100ms upsert dedup; uses primary key hash map in memory; designed for high-frequency key updates |

**When to pick which:**
- Need **strong ACID consistency** for upserts → Databricks Delta `MERGE INTO`
- Need **sub-100ms upsert + query** for user-facing features → Pinot upsert tables
- Need **cost-effective eventual dedup** at scale with SQL → ClickHouse `ReplacingMergeTree + FINAL`
- Need **simple managed SQL upsert** → Snowflake `MERGE INTO`

---

### Engine 5: CollapsingMergeTree (Sign-Based CDC)

Each row has a `sign` column: `+1` to insert, `-1` to cancel. Background merge collapses pairs to zero.

| Platform | Equivalent | Key difference |
|---|---|---|
| **ClickHouse CollapsingMergeTree** | — | Write-side CDC via sign; very efficient for correction-heavy workloads |
| **Snowflake** | Streams + Tasks (CDC) | Snowflake Streams track change sets; Tasks process them; DML-based, not storage-engine-based |
| **Databricks** | Delta Change Data Feed | Delta Change Data Feed exposes insert/update/delete events from the transaction log; Spark processes them |
| **Apache Pinot** | Not natively supported | Pinot lacks a native collapsing/CDC storage pattern; workarounds via upsert + dedup |

**Real-world use:** Running account balances, position books in trading, inventory deltas. Instead of `UPDATE balance = balance - 50`, you write TWO rows: the old balance with `sign=-1` and the new balance with `sign=+1`.

---

### Engine 6: MergeTree + TTL (Automatic Data Lifecycle)

Rows or columns expire and are deleted automatically when a TTL expression fires. Supports tiered storage (hot → warm → cold S3).

| Platform | Equivalent | Key difference |
|---|---|---|
| **ClickHouse TTL** | — | Per-row AND per-column expiry at the storage engine level; tiered storage to S3 via `MOVE TO VOLUME` |
| **Snowflake** | Data Retention + Time Travel (cost-based) | Retention is for recovery, not compliance deletion; dropping old data requires explicit scripting |
| **Databricks** | `VACUUM` command + table retention settings | Delta `VACUUM` removes old Parquet files; not time-based row expiry, but partition-level lifecycle |
| **Apache Pinot** | Retention policy per segment | Segments beyond retention are automatically deleted at the segment manager level; simple and effective |

**Real-world use:** Log tables with a 30-day legal retention. ClickHouse deletes without any external job. Databricks needs a scheduled `VACUUM`. Snowflake needs a scripted `DELETE + MERGE`.

---

## Part 3 — Platform Decision Matrix

Use this when picking a platform for a new workload:

| Requirement | Best fit | Why |
|---|---|---|
| Sub-100ms user-facing queries on live data | **Apache Pinot** | Designed for this; star-tree + real-time segments |
| Sub-second ad-hoc analytics on 1B rows | **ClickHouse** | Vectorised SIMD, sparse primary index, no warm-up |
| ACID transactions + complex upserts | **Databricks Delta** | Gold standard; Z-ordering + transaction log |
| Managed cloud DW with SQL standards | **Snowflake** | Best ecosystem; slowest for real-time; highest cost |
| High-throughput append-only ingest with pre-aggregation | **ClickHouse** | AggregatingMergeTree + MV is uniquely elegant |
| Cost-effective log storage + full-text search | **ClickHouse** | Beats Elasticsearch on cost; not as flexible on schema |
| ML feature engineering on petabytes | **Databricks** | Spark + MLflow + Delta is purpose-built |
| Auto-summing billing/usage counters | **ClickHouse** | SummingMergeTree has no equivalent elsewhere |
| Kafka real-time stream + instant dedup | **Pinot** or **ClickHouse** | Pinot for < 100ms; ClickHouse for < 1s + simpler ops |

---

## Part 4 — What ClickHouse Is NOT Great For

Knowing when **not** to use a tool is as important as knowing when to use it:

| Workload | Better choice | Why ClickHouse struggles |
|---|---|---|
| **OLTP** (many small point-read/writes) | PostgreSQL, MySQL | Every INSERT creates a part; row-level reads are slow |
| **ACID multi-table transactions** | Databricks Delta, PostgreSQL | ClickHouse has no cross-table transactions |
| **Complex joins on normalised schemas** | Snowflake, BigQuery | ClickHouse prefers wide denormalised tables |
| **Frequent UPDATEs** (e.g. CRM records) | PostgreSQL, DynamoDB | Mutations in ClickHouse rewrite entire parts |
| **Full-text search at scale** | Elasticsearch, Typesense | `tokenbf_v1` helps but ClickHouse is not a search engine |
| **Graph traversal / recursive queries** | Neo4j, PostgreSQL (recursive CTE) | No native graph primitives |
| **ML model training** | Databricks, Spark | ClickHouse can't run Spark/PyTorch workloads |

---

## Summary

```
Fast ad-hoc analytics on big datasets?          → ClickHouse MergeTree
Auto-summing counters / billing?                → ClickHouse SummingMergeTree
Pre-aggregated dashboards at any scale?         → ClickHouse AggregatingMergeTree + MV
Idempotent Kafka ingest with dedup?             → ClickHouse ReplacingMergeTree
CDC / correction-heavy financial data?          → ClickHouse CollapsingMergeTree
Log retention with auto-expiry?                 → ClickHouse MergeTree + TTL

Strong ACID upserts + complex pipelines?        → Databricks Delta Lake
Managed cloud DW, BI tools, SQL ecosystem?      → Snowflake
Sub-100ms user-facing queries on live data?     → Apache Pinot
OLTP + random-access reads/writes?              → PostgreSQL / MySQL
```

---

## Further Reading

- [ClickHouse vs Snowflake (official benchmark)](https://clickhouse.com/comparison/snowflake)
- [ClickHouse vs Databricks](https://clickhouse.com/comparison/databricks)
- [Apache Pinot use cases](https://docs.pinot.apache.org/basics/getting-started/frequent-questions/general-questions)
- [When to use Delta Lake vs other formats](https://delta.io/learn/tutorials/)
- [ClickHouse MergeTree engine families — docs](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family)
