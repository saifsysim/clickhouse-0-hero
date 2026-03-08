# 🛍️ Shoppers Paradise — ClickHouse Scenario Reference

A multi-vendor shopping analytics platform demonstrating 7 ClickHouse analytical use cases.  
**145,000+ rows** across 8 tables. All data is synthetic and seeded via `backend/seed.js`.

---

## Why ClickHouse for This App?

### The Problem Space

A multi-vendor shopping platform has a fundamentally different data profile than a typical web app:

| Characteristic | Shopping Platform Reality |
|---|---|
| Write volume | Millions of price events per day (10 vendors × scrape frequency) |
| Read pattern | Aggregate queries — "avg price by vendor over last 7 days" — not "find order #8472" |
| Data shape | Wide, flat events — not deeply normalized relationships |
| Latency requirement | Dashboard must respond in milliseconds, not seconds |
| Update pattern | Price changes are new events, not row mutations |
| Cardinality | Millions of users, thousands of SKUs, hundreds of vendors |

This is an **OLAP workload** (Online Analytical Processing), not an OLTP one. That distinction drives every technology choice.

---

### Why Not Postgres / MySQL?

A row-oriented database like Postgres works like this:

```
Row 1: [event_ts, vendor_id, sku_id, product_name, category, brand, price_usd, in_stock]
Row 2: [event_ts, vendor_id, sku_id, product_name, category, brand, price_usd, in_stock]
...
Row 60,000: ...
```

When you run `SELECT avg(price_usd) FROM sp_price_events WHERE category = 'Electronics'`, Postgres must **load every column of every row** into memory — even `product_name`, `brand`, `sku_id` — just to filter and compute an average on two columns.

At 60,000 rows that's manageable. At 60 million rows (realistic production volume), that's a full-table scan loading gigabytes of data you never needed.

**The compounding problem:** Postgres also can't efficiently skip rows. Without a B-tree index on `category`, it reads everything. With a B-tree index on `category`, it reads the index + random I/O to fetch matching rows — still slow for aggregate queries that return millions of rows.

---

### How ClickHouse Solves It

**1. Columnar storage** — each column is stored separately on disk:
```
price_usd column: [21.00, 10.51, 160.69, 300.58, 80.50, ...]   ← read only this
category column:  [Electronics, Electronics, Sports, ...]        ← and this
event_ts column:  [2026-03-08 09:02, 2026-03-08 07:59, ...]    ← and this
```
`avg(price_usd)` reads only the `price_usd` and `category` columns. The remaining 6 columns are never touched.

**2. Sparse index + granule skipping** — ClickHouse doesn't index every row. It stores index marks every 8,192 rows (one granule). When you filter `WHERE event_ts >= now() - INTERVAL 7 DAY`, it locates the first relevant granule and skips everything before it. With 60,000 rows ordered by `event_ts`, a 7-day window query might only read 10,000 rows, not all 60,000.

**3. Vectorized execution** — ClickHouse processes data in batches of 8,192 rows using SIMD CPU instructions. `countIf(stage='converted')` evaluates 8,192 conditions simultaneously, not one at a time.

**4. Compression** — columnar data compresses far better than rows. `LowCardinality(String)` on fields like `vendor_id` (10 distinct values) uses dictionary encoding — storing a 1-byte integer instead of a 10-character string. The 60,000-row price table compresses to ~800KB on disk.

---

### Why Not BigQuery / Snowflake?

Those are also columnar OLAP databases and would absolutely work for this problem. The trade-offs:

| | ClickHouse | BigQuery / Snowflake |
|---|---|---|
| Latency | Sub-second on local data | 1–5 seconds cold, faster warm |
| Deployment | Self-hosted, your infra | Fully managed cloud |
| Cost model | Fixed infrastructure cost | Pay per byte scanned |
| Real-time ingestion | Native streaming, low latency | Streaming costs extra, higher latency |
| Materialized Views | First-class, fires on insert | Scheduled refreshes (not insert-triggered) |
| Special engines | ReplacingMergeTree, AggMT, etc. | Generic table types only |

For a **real-time price tracking** platform where vendor feeds update every few minutes and dashboards must reflect the latest prices immediately, ClickHouse's insert-triggered Materialized Views are a significant advantage. BigQuery MVs refresh on a schedule, not on insert.

---

### The Specific Wins for Each Use Case

**Price Intelligence:** 60,000 price rows. `GROUP BY sku_id, vendor_id, HAVING pct_drop > 10` — ClickHouse reads only the `price_usd`, `event_ts`, `category`, and key columns. On Postgres this would require a full heap scan. ClickHouse reads ~3% of the data.

**Coupon Funnel:** `countIf(stage='seen'), countIf(stage='converted')` in one pass. Postgres equivalent requires either a self-join, 4 subqueries, or a `CASE WHEN` expression evaluated row by row. ClickHouse vectorizes all conditions simultaneously.

**Cashback Attribution:** Finding leakage (`attributed=0`) while simultaneously computing ROI across 20,000 rows is trivial for ClickHouse — it's a single aggregation pass. In Postgres, this would be noticeably slow once you scale to 20 million orders.

**Vendor Feed (Real-Time):** `ReplacingMergeTree` means a vendor price update is just an INSERT. No `UPDATE vendor SET price = X WHERE vendor_id = Y AND sku_id = Z`. ClickHouse's architecture makes updates expensive because it rewrites immutable parts — so ReplacingMergeTree gives you update semantics (latest version wins) via insert-only writes.

**Live Dashboards (Materialized Views):** Every INSERT into `sp_price_events` automatically updates the hourly aggregates in `sp_price_hourly_agg` — no cron job, no scheduled refresh, no ETL pipeline. The dashboard always reads from pre-computed states. This is architecturally impossible with a Postgres or MySQL materialized view (which are snapshot-based, not insert-triggered with partial states).

---

### When You'd Reach for ClickHouse in Production

A shopping analytics platform would use ClickHouse specifically for:

- **Price history and trend analysis** — billions of price observations across millions of products
- **Real-time vendor feed deduplication** — ReplacingMergeTree handles 10,000 feed updates/second without locks
- **Live dashboards** — Materialized Views keep aggregates current without re-scanning raw data
- **Coupon and cashback analytics** — `countIf` aggregations over hundreds of millions of events
- **User behavior segmentation** — `LIMIT N BY` and window functions over 500M+ session rows

You'd keep Postgres for the transactional parts: user accounts, order records, payment state, coupon issuance — anything that requires `UPDATE`, `DELETE`, or strict ACID guarantees on individual rows.

**ClickHouse and Postgres are complementary, not competing.** ClickHouse wins on analytical reads at scale. Postgres wins on transactional writes with relational integrity.

---


## Overview

| Stat | Value |
|---|---|
| Vendors | 10 (Amazon, Walmart, Target, Best Buy, Costco, eBay, Wayfair, Nike.com, Macy's, Costco) |
| SKUs | 30 products |
| Categories | Electronics, Clothing, Home & Garden, Sports, Beauty, Toys, Grocery, Automotive |
| Shopper Segments | deal_hunter, brand_loyal, browser, impulse |
| Total rows seeded | ~145,000 |

---

## Table Structure

### 1. `sp_price_events` — MergeTree (60,000 rows)

Every price observation scraped from vendors. The **hot write path** — the Materialized View listens to this table.

```sql
CREATE TABLE demo.sp_price_events (
  event_ts      DateTime,
  vendor_id     LowCardinality(String),   -- 'amzn', 'wmt', 'tgt', etc.
  vendor_name   LowCardinality(String),   -- 'Amazon', 'Walmart', etc.
  sku_id        String,                   -- 'SKU00001' … 'SKU00030'
  product_name  String,
  category      LowCardinality(String),   -- 'Electronics', 'Clothing', etc.
  brand         LowCardinality(String),   -- 'Samsung', 'Nike', 'Adidas', etc.
  price_usd     Float64,
  in_stock      UInt8                     -- 0 = out, 1 = in stock
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_ts)
ORDER BY (event_ts, vendor_id, sku_id);
```

**Why MergeTree?** Append-only price events, queried by time range and category. Sparse index on `(event_ts, vendor_id, sku_id)` means ClickHouse can skip large ranges without scanning.

---

### 2. `sp_coupon_events` — MergeTree (~43,000 rows)

Every stage of the coupon funnel per user. One row per stage event.

```sql
CREATE TABLE demo.sp_coupon_events (
  event_ts     DateTime,
  user_id      String,
  vendor_id    LowCardinality(String),
  coupon_code  String,                    -- 'SAVE10', 'DEAL25', 'FLASH15', etc.
  discount_pct Float64,                   -- 5.0 … 30.0
  stage        LowCardinality(String),    -- 'seen' | 'clicked' | 'applied' | 'converted'
  savings_usd  Float64,                   -- 0 unless converted
  order_usd    Float64                    -- 0 unless converted
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_ts)
ORDER BY (event_ts, user_id, coupon_code);
```

**Key query pattern:** `countIf(stage='converted') / countIf(stage='seen')` — full funnel in one pass, no subqueries.

---

### 3. `sp_cashback_events` — MergeTree (20,000 rows)

Every completed purchase with cashback tracking.

```sql
CREATE TABLE demo.sp_cashback_events (
  event_ts              DateTime,
  user_id               String,
  vendor_id             LowCardinality(String),
  vendor_name           LowCardinality(String),
  order_usd             Float64,
  cashback_pct          Float64,           -- % the user earns back
  cashback_usd          Float64,           -- actual dollars paid out
  affiliate_revenue_usd Float64,           -- what the platform earns from vendor
  attributed            UInt8              -- 1 = tracked, 0 = leakage (pixel missed)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_ts)
ORDER BY (event_ts, vendor_id, user_id);
```

**Net margin formula:** `sum(affiliate_revenue_usd) - sum(cashback_usd)`. Leakage (`attributed=0`) means the affiliate pixel fired but wasn't captured.

---

### 4. `sp_user_sessions` — MergeTree (40,000 rows)

One row per page visit. Tracks the full cross-vendor browsing journey.

```sql
CREATE TABLE demo.sp_user_sessions (
  session_ts      DateTime,
  user_id         String,
  user_segment    LowCardinality(String), -- 'deal_hunter' | 'brand_loyal' | 'browser' | 'impulse'
  vendor_id       LowCardinality(String),
  sku_id          String,
  category        LowCardinality(String),
  page_type       LowCardinality(String), -- 'search' | 'pdp' | 'compare' | 'cart' | 'checkout'
  time_on_page_s  UInt16,                 -- seconds spent on page
  price_shown     Float64,                -- what the user saw
  converted       UInt8                   -- 1 = purchased
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(session_ts)
ORDER BY (session_ts, user_segment, user_id);
```

**Key query pattern:** `LIMIT 3 BY user_segment` — top-N per group without a window function.

---

### 5. `sp_vendor_feed` — ReplacingMergeTree(feed_version) (300 rows)

Live price feed. 10 vendors × 30 SKUs. Only the **latest version per vendor+SKU** survives after merge.

```sql
CREATE TABLE demo.sp_vendor_feed (
  ingested_at  DateTime,
  vendor_id    LowCardinality(String),
  sku_id       String,
  product_name String,
  category     LowCardinality(String),
  price_usd    Float64,
  in_stock     UInt8,
  feed_version UInt64                    -- Unix timestamp ms; higher = newer
)
ENGINE = ReplacingMergeTree(feed_version)
ORDER BY (vendor_id, sku_id);
```

**How to use:**
```sql
-- Insert a new price update (no DELETE needed):
INSERT INTO demo.sp_vendor_feed VALUES (now(), 'amzn', 'SKU00001', ..., toUnixTimestamp(now()));

-- Read current state (force dedup):
SELECT * FROM demo.sp_vendor_feed FINAL WHERE sku_id = 'SKU00001';
```

---

### 6. `sp_product_catalog` — ReplacingMergeTree(updated_at) (30 rows)

Master product catalog. One row per SKU. Latest `updated_at` wins.

```sql
CREATE TABLE demo.sp_product_catalog (
  sku_id        String,
  product_name  String,
  category      LowCardinality(String),
  brand         LowCardinality(String),
  min_price_usd Float64,
  avg_price_usd Float64,
  vendor_count  UInt8,                  -- how many vendors carry this SKU
  avg_rating    Float32,                -- 1.0–5.0
  review_count  UInt32,
  updated_at    DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (sku_id);
```

**Freshness query:**
```sql
SELECT category, dateDiff('hour', max(updated_at), now()) AS hours_stale
FROM demo.sp_product_catalog
GROUP BY category;
```

---

### 7. `sp_price_hourly_agg` — AggregatingMergeTree (13,000 rows)

Pre-aggregated target table. **Never written to by the app directly** — only the Materialized View writes here.

```sql
CREATE TABLE demo.sp_price_hourly_agg (
  hour        DateTime,
  category    LowCardinality(String),
  vendor_id   LowCardinality(String),
  -- Stored as partial aggregate states, not final values:
  price_count AggregateFunction(count),
  avg_price   AggregateFunction(avg, Float64),
  min_price   AggregateFunction(min, Float64),
  unique_skus AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
ORDER BY (hour, category, vendor_id);
```

**Dashboard query against this table:**
```sql
SELECT
  hour, vendor_id,
  countMerge(price_count)      AS price_updates,
  round(avgMerge(avg_price),2) AS avg_price,
  uniqMerge(unique_skus)       AS unique_skus
FROM demo.sp_price_hourly_agg
WHERE category = 'Electronics' AND hour >= now() - INTERVAL 7 DAY
GROUP BY hour, vendor_id
ORDER BY hour DESC;
```

---

### 8. `mv_sp_price_hourly` — Materialized View (trigger only, no rows)

Fires on every INSERT into `sp_price_events`. Writes **partial states** into `sp_price_hourly_agg`.

```sql
CREATE MATERIALIZED VIEW demo.mv_sp_price_hourly
TO demo.sp_price_hourly_agg AS
SELECT
  toStartOfHour(event_ts) AS hour,
  category,
  vendor_id,
  countState()          AS price_count,
  avgState(price_usd)   AS avg_price,
  minState(price_usd)   AS min_price,
  uniqState(sku_id)     AS unique_skus
FROM demo.sp_price_events
GROUP BY hour, category, vendor_id;
```

---

## Data Relationships (ERD)

```
sp_price_events (60k rows, MergeTree)
    │
    │  every INSERT triggers
    ▼
mv_sp_price_hourly ──────────────► sp_price_hourly_agg (13k agg states, AggMT)
(Materialized View)                 queried by Live Dashboards use case

sp_vendor_feed (300 rows, ReplacingMT)      sp_product_catalog (30 rows, ReplacingMT)
  deduplicated by feed_version                deduplicated by updated_at
  read with FINAL                             read with FINAL

sp_coupon_events (43k, MergeTree)
sp_cashback_events (20k, MergeTree)
sp_user_sessions (40k, MergeTree)
```

---

## 7 Use Cases

### Use Case 1 — Price Intelligence & Trend Analysis
**Engine:** MergeTree  
**API:** `GET /api/shoppers/price-intelligence?category=Electronics&days=7`

Detects price drops >10% across vendors, compares vendor pricing, shows daily price trend.

**Key SQL:**
```sql
SELECT
  sku_id, product_name, vendor_name,
  min(price_usd)  AS low_price,
  max(price_usd)  AS high_price,
  round((max(price_usd) - min(price_usd)) / max(price_usd) * 100, 1) AS pct_drop
FROM demo.sp_price_events
WHERE event_ts >= now() - INTERVAL 7 DAY AND category = 'Electronics'
GROUP BY sku_id, product_name, vendor_name
HAVING pct_drop > 10
ORDER BY pct_drop DESC
LIMIT 10;
```

**ClickHouse features:** Sparse index skips irrelevant time ranges. Columnar reads only `price_usd`, `event_ts`, `category`.

---

### Use Case 2 — Coupon & Deal Effectiveness
**Engine:** MergeTree + `countIf()`  
**API:** `GET /api/shoppers/coupon-effectiveness`

Full funnel: seen → clicked → applied → converted. Identifies which coupon codes convert best.

**Key SQL:**
```sql
SELECT
  coupon_code,
  countIf(stage='seen')       AS seen,
  countIf(stage='converted')  AS converted,
  round(countIf(stage='converted') / greatest(countIf(stage='seen'), 1) * 100, 1) AS conversion_pct,
  round(sum(savings_usd), 2)  AS total_savings_usd
FROM demo.sp_coupon_events
GROUP BY coupon_code;
```

**ClickHouse features:** `countIf()` computes the entire funnel in a single pass. No CASE WHEN, no window functions, no subqueries.

---

### Use Case 3 — Cashback & Rewards Attribution
**Engine:** MergeTree  
**API:** `GET /api/shoppers/cashback-attribution`

Compares cashback paid out vs. affiliate revenue earned per vendor. Detects attribution leakage.

**Key SQL:**
```sql
SELECT
  vendor_name,
  round(sum(affiliate_revenue_usd) - sum(cashback_usd), 2) AS net_margin,
  countIf(attributed=0) AS leakage_count
FROM demo.sp_cashback_events
GROUP BY vendor_name
ORDER BY net_margin DESC;
```

**ClickHouse features:** `countIf(attributed=0)` finds leakage without a filter subquery. Columnar aggregation over 20k rows is sub-millisecond.

---

### Use Case 4 — User Behavior & Personalization
**Engine:** MergeTree + `LIMIT N BY`  
**API:** `GET /api/shoppers/user-behavior`

Compares 4 shopper segments (deal_hunter, brand_loyal, browser, impulse) on conversion rate, cross-vendor journeys, and price sensitivity.

**Key SQL (LIMIT N BY — ClickHouse-specific):**
```sql
SELECT
  user_segment, category,
  round(avg(price_shown), 2)  AS avg_willingness_to_pay,
  round(countIf(converted=1)/count()*100, 1) AS conversion_pct
FROM demo.sp_user_sessions
GROUP BY user_segment, category
ORDER BY user_segment, sessions DESC
LIMIT 3 BY user_segment;   -- top 3 categories per segment, single pass
```

**ClickHouse features:** `LIMIT N BY` is a ClickHouse-specific operator for top-N per group — avoids `ROW_NUMBER() OVER (PARTITION BY ...)` entirely.

---

### Use Case 5 — Real-Time Vendor Feed Ingestion
**Engine:** ReplacingMergeTree(feed_version)  
**API:** `GET /api/shoppers/vendor-feed-ingest?sku_id=SKU00001`  
       `POST /api/shoppers/vendor-feed-ingest` (insert a new feed row)

Simulates a live price feed from 10 vendors. Inserting a new row with a higher `feed_version` "updates" the price without using mutations.

**How it works:**
1. Vendor sends new price → app inserts row with `feed_version = Date.now()`
2. ClickHouse background merge keeps only the highest `feed_version` per `(vendor_id, sku_id)`
3. Dashboard queries with `FINAL` to force synchronous dedup

**ClickHouse features:** `ReplacingMergeTree(feed_version)` — update semantics via insert. No `UPDATE` statements ever touch the table. `FINAL` keyword forces dedup at read time.

---

### Use Case 6 — Product Catalog Intelligence
**Engine:** ReplacingMergeTree(updated_at)  
**API:** `GET /api/shoppers/catalog-intelligence`

Brand market share, category depth, data freshness scoring, top-rated products per category.

**Key SQL (LIMIT 2 BY — top 2 products per category):**
```sql
SELECT category, brand, product_name, avg_rating, review_count
FROM demo.sp_product_catalog FINAL
ORDER BY category, avg_rating DESC, review_count DESC
LIMIT 2 BY category;
```

**ClickHouse features:** `FINAL` on `ReplacingMergeTree` ensures each SKU appears once. `LIMIT 2 BY` replaces a window function. `dateDiff('hour', updated_at, now())` gives real-time freshness scoring.

---

### Use Case 7 — Materialized Views for Live Dashboards
**Engine:** AggregatingMergeTree + Materialized View  
**API:** `GET /api/shoppers/live-dashboard?category=Electronics`

Benchmarks raw table scan vs. MV query. Shows live KPIs from pre-aggregated states.

**Raw query (scans all rows):**
```sql
SELECT toStartOfHour(event_ts) AS hour, vendor_id,
  count()          AS price_updates,
  avg(price_usd)   AS avg_price,
  uniq(sku_id)     AS unique_skus
FROM demo.sp_price_events
WHERE category = 'Electronics'
GROUP BY hour, vendor_id;
```

**MV query (merges pre-computed states — much faster):**
```sql
SELECT hour, vendor_id,
  countMerge(price_count)      AS price_updates,
  round(avgMerge(avg_price),2) AS avg_price,
  uniqMerge(unique_skus)       AS unique_skus
FROM demo.sp_price_hourly_agg
WHERE category = 'Electronics'
GROUP BY hour, vendor_id;
```

**ClickHouse features:** MV fires on INSERT, writing `countState/avgState/minState/uniqState` partial aggregates. Dashboard never reads raw rows — only merges partial states.

---

## ClickHouse Features Used — Summary

| Feature | Where | Why It Matters |
|---|---|---|
| `MergeTree` + sparse index | All event tables | Skip time ranges without full scan |
| Columnar storage | All tables | Read only queried columns, not entire rows |
| `LowCardinality(String)` | vendor_id, category, etc. | Dictionary encoding — 10x compression on repeated strings |
| `countIf(condition)` | Coupon funnel, cashback leakage | Full multi-condition aggregation in one pass |
| `LIMIT N BY col` | User behavior, catalog | Top-N per group without window functions |
| `ReplacingMergeTree(ver)` | Vendor feed, catalog | Update semantics via insert — no mutations needed |
| `FINAL` | Feed & catalog reads | Force synchronous dedup at read time |
| `AggregatingMergeTree` | Dashboard agg table | Store partial aggregate states, not raw values |
| Materialized View | Price hourly rollup | Pre-aggregate on insert — dashboards skip raw data entirely |
| `*State()` / `*Merge()` | MV writes / dashboard reads | Incremental aggregation: partial states combined at query time |
| `uniq()` (HyperLogLog) | Distinct counts everywhere | Approximate cardinality in O(1) memory |
| `dateDiff()` | Catalog freshness | Native time arithmetic |
| `multiIf()` | Ordering, classification | Vectorizable alternative to CASE WHEN |
| `PARTITION BY toYYYYMM()` | All event tables | Enables partition pruning for time-range queries |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/shoppers/seed-status` | Row counts for all sp_* tables |
| `GET` | `/api/shoppers/price-intelligence` | Price drops, vendor comparison, daily trend |
| `GET` | `/api/shoppers/coupon-effectiveness` | Coupon funnel, top coupons, vendor funnel |
| `GET` | `/api/shoppers/cashback-attribution` | Vendor ROI, top savers, leakage analysis |
| `GET` | `/api/shoppers/user-behavior` | Segment comparison, cross-vendor journey, drop-off |
| `GET` | `/api/shoppers/vendor-feed-ingest` | Current FINAL snapshot of a SKU across vendors |
| `POST` | `/api/shoppers/vendor-feed-ingest` | Insert a new vendor price update |
| `GET` | `/api/shoppers/catalog-intelligence` | Brand share, category stats, freshness, top-rated |
| `GET` | `/api/shoppers/live-dashboard` | Raw vs. MV benchmark + live KPIs |

**Query params:**
- `?category=Electronics` — filters price intelligence and live dashboard (default: `Electronics`)
- `?days=7` — lookback window for price intelligence (default: `7`)
- `?sku_id=SKU00001` — SKU to view in vendor feed snapshot

---

## Seed Data

Run via: `node backend/seed.js`

| Table | Rows | Generation Logic |
|---|---|---|
| `sp_price_events` | 60,000 | 10 vendors × 30 SKUs × ~200 price events each over 30 days |
| `sp_coupon_events` | ~43,000 | 25,000 base events across 4 funnel stages with realistic drop-offs |
| `sp_cashback_events` | 20,000 | 20,000 orders with random cashback %, ~15% leakage rate |
| `sp_user_sessions` | 40,000 | 40,000 sessions across 4 segments, 5 page types |
| `sp_vendor_feed` | 300 | 10 vendors × 30 SKUs, latest prices |
| `sp_product_catalog` | 30 | One row per SKU with ratings and pricing |
| `sp_price_hourly_agg` | ~13,000 | Populated automatically by MV on price_events insert |

---

## Files

| File | Purpose |
|---|---|
| `backend/seed.js` | DDL + seed data for all 8 sp_* tables |
| `backend/server.js` | 7 `/api/shoppers/*` API routes |
| `frontend/shoppers.js` | Frontend module — renders all 7 scenario panels |
| `frontend/style.css` | All `.sp-*` CSS classes (appended at end of file) |
| `frontend/index.html` | `<section id="tab-shoppers">` + nav item + script tag |
| `frontend/app.js` | `switchTab()` calls `initShoppers()` on tab activation |
