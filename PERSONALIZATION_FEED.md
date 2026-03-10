# 🧠 Personalization Feed — Use Case Deep Dive

## The Problem

A **shopping browser extension** sits in millions of users' browsers, silently recording every page they visit — which retailer, which product category, how long they dwell, what they clicked.

When a user lands on your **homepage**, you want to show them a ranked feed of the most relevant stores and deals based on their recent browsing. Simple idea. Hard to build at scale.

### Why the Naive Approach Breaks

Most teams reach for the obvious solution: a **scheduled cron job** that runs every N minutes, reads all page views, groups them by user, and writes a summary to a `user_profile` table.

```
Extension → Kafka/Queue → Raw event store → [CRON every 5 min] → user_profile table → Homepage
```

This creates three compounding problems:

| Problem | Impact |
|---|---|
| **Latency** | Feed is always 5–15 min stale. User visits 20 amazon.com pages, feed still shows walmart |
| **Single-purpose schema** | Cron writes `top_domains` only. Later you need per-category breakdown — rewrite cron |
| **Scaling wall** | As event volume grows, cron takes longer. At 10M users it runs for 40 min every 5 min |

---

## The ClickHouse Solution

Replace the cron entirely with a **Materialized View + AggregatingMergeTree** pipeline. The MV fires on every single INSERT, computing the same result the cron would have, but incrementally.

### Architecture

```
Browser Extension
    │ async INSERT (fire-and-forget, buffered)
    ▼
demo.page_views              ← MergeTree, raw events
    │ Materialized View fires automatically on every INSERT
    ▼
demo.pv_user_profile         ← AggregatingMergeTree, running partial states
    │ Homepage queries this
    ▼
Ranked Feed (sub-50ms)
```

### The Three Tables

**1. `page_views` — Raw Events (MergeTree)**

```sql
CREATE TABLE demo.page_views (
    user_id     String,
    session_id  String,
    domain      String,           -- "amazon.com", "walmart.com"
    url_path    String,
    category    LowCardinality(String),
    product_id  String,
    dwell_ms    UInt32,           -- how long they stayed on the page
    viewed_at   DateTime
)
ENGINE = MergeTree()
ORDER BY (user_id, domain, viewed_at)
PARTITION BY toYYYYMM(viewed_at);
```

Written to directly by every extension event. No pre-processing. Pure append.

---

**2. `pv_user_profile` — Pre-Aggregated Profile (AggregatingMergeTree)**

```sql
CREATE TABLE demo.pv_user_profile (
    user_id         String,
    domain          String,
    category        LowCardinality(String),
    -- These store PARTIAL aggregation states, not final values
    view_count      AggregateFunction(count, UInt8),
    total_dwell_ms  AggregateFunction(sum,   UInt32),
    last_seen       AggregateFunction(max,   DateTime),
    unique_products AggregateFunction(uniq,  String)
)
ENGINE = AggregatingMergeTree()
ORDER BY (user_id, domain, category);
```

This table never gets written to by your app. Only the MV writes to it.

**AggregateFunction columns** store intermediate binary states (not readable numbers) that ClickHouse knows how to merge later. Think of `countState()` as "an unfinished count" that can be combined with other unfinished counts from future batches.

---

**3. `pv_mv` — Materialized View (the cron replacement)**

```sql
CREATE MATERIALIZED VIEW demo.pv_mv
TO demo.pv_user_profile AS
SELECT
    user_id, domain, category,
    countState()           AS view_count,
    sumState(dwell_ms)     AS total_dwell_ms,
    maxState(viewed_at)    AS last_seen,
    uniqState(product_id)  AS unique_products
FROM demo.page_views
GROUP BY user_id, domain, category;
```

**You run this DDL once. It never runs again. It is not recreated on each INSERT.**

---

### How the MV Actually Works — It's a Trigger, Not a View

The name "Materialized View" is misleading. In ClickHouse, an MV is closer to a **database trigger** than a traditional materialised view.

```
Traditional SQL MV (PostgreSQL / Redshift):    ClickHouse MV:
─────────────────────────────────────────────  ─────────────────────────────────────────
Stores the full query result                   Stores partial aggregate states
Refreshed manually or on a schedule            Fires on every INSERT automatically
Reads the entire source table on refresh       Reads ONLY the new batch (the delta)
Expensive to keep current                      Free — happens at insert time
```

**On every INSERT, ClickHouse:**

```
INSERT (25 rows from extension)
    │
    ├─ 1. Writes those 25 rows to page_views           (normal write)
    │
    └─ 2. MV trigger fires on JUST those 25 rows
               │
               ├─ Runs the SELECT on the new batch only
               ├─ Produces partial states: countState(), sumState(), maxState()
               └─ Appends one new row per (user, domain, category) group
                  to pv_user_profile
```

The MV **never reads the full `page_views` table**. Each fire only sees the rows that arrived in that INSERT — the incremental delta.

---

### How Partial States Stack Over Time

Say the user visits `amazon.com/Electronics` across three separate extension events:

```
pv_user_profile after INSERT 1:  [user_001, amazon.com, Electronics | state(count=5)  | state(max=10:00)]
pv_user_profile after INSERT 2:  [user_001, amazon.com, Electronics | state(count=8)  | state(max=14:00)]
pv_user_profile after INSERT 3:  [user_001, amazon.com, Electronics | state(count=3)  | state(max=17:00)]
```

Three separate rows accumulate. ClickHouse **merges them in the background** during its normal merge process, collapsing them into one:

```
pv_user_profile (after merge):   [user_001, amazon.com, Electronics | state(count=16) | state(max=17:00)]
```

When you query with `countMerge(view_count)`, ClickHouse handles both cases:
- **Already merged** → reads one row, done instantly
- **Not yet merged** → reads multiple rows, combines them on the fly during query

Either way, **the result is always correct and always current**. The query never waits for a merge to happen.

---

**You write this once. It runs forever, for free.**

Every time the extension fires an INSERT into `page_views`, ClickHouse automatically processes the new rows through the MV. No scheduler. No worker. No catch-up logic. No lag.

---

### The Homepage Feed Query

```sql
SELECT
    domain, category,
    countMerge(view_count)                                              AS views,
    round(sumMerge(total_dwell_ms) / countMerge(view_count) / 1000, 1) AS avg_dwell_sec,
    maxMerge(last_seen)                                                 AS last_seen,
    uniqMerge(unique_products)                                          AS products_seen
FROM demo.pv_user_profile
WHERE user_id = 'user_001'
GROUP BY domain, category
ORDER BY views DESC
LIMIT 10;
```

- `countMerge()` / `sumMerge()` / `maxMerge()` — finalize the partial states in real time
- Query reads from **the AggMT** (tiny, pre-grouped), not from the 50k raw rows
- Sub-50ms even as `page_views` grows to hundreds of millions

---

## Why ClickHouse Specifically

### 1. Async Inserts (Extension Safety Net)
The browser extension can't wait for each page view to commit before continuing. `async_insert=1` lets the extension fire-and-forget — ClickHouse buffers events internally, batches them, and commits efficiently. Zero data loss risk, zero extension latency.

```sql
-- Extension sends with:
SET async_insert = 1;
SET async_insert_deduplicate = 0;
INSERT INTO demo.page_views VALUES (...);
```

### 2. Materialized Views are Zero-Maintenance
Unlike a cron:
- No infrastructure to manage (no scheduler, no worker process)
- No catch-up logic if the cron misses a run
- Handles write spikes transparently — MV just processes more batches

### 3. AggregatingMergeTree is Built for This
`countState()/countMerge()` is not just a trick — it's the designed mechanism for **incremental aggregation at write time**. Each new batch of extension events gets merged into the running state. The final `countMerge()` in the feed query costs almost nothing because all the work happened at insert time.

### 4. Flexible Queries Without Schema Changes
With the cron approach, adding a new dimension (e.g., time-of-day preference) means rewriting the cron and backfilling. With ClickHouse:
- Add the column to `page_views`
- Update the MV
- Query the new dimension immediately

Users visiting mostly evenings? `WHERE toHour(viewed_at) BETWEEN 18 AND 22`. No new aggregation infrastructure needed.

### 5. Columnar Storage = Fast Point Queries
`WHERE user_id = 'user_001'` on a 50M row table is instant because ClickHouse stores `user_id` as a separate column, sorted (it's the ORDER BY key). The index skips directly to that user's data — no full table scan.

---

## Benchmark (Observed — 50k Events, 20 Users)

| Query | Time | What It Reads |
|---|---|---|
| AggMT feed (this approach) | **~50ms** | Pre-aggregated profile — tiny |
| Raw GROUP BY on page_views | ~15ms | 50k rows (fast at small scale) |

> At **500k events**: raw GROUP BY becomes 5–10× slower. AggMT stays flat because the AggMT row count doesn't grow proportionally with raw events — it stays at `users × domains × categories`.

---

## What You'd Build Next

| Feature | ClickHouse Tool |
|---|---|
| Real-time trending products (site-wide) | Second MV on `page_views` summing by `product_id` |
| User cohort feed (similar users) | ANN index on user embedding vectors (ClickHouse 24.x) |
| Feed with discount prioritization | Join AggMT output with `sp_price_events` at query time |
| Cold-start (new users) | Fall back to site-wide trending from a third MV |
| Time-decay weighting | Partition AggMT by `toStartOfHour(viewed_at)` |
