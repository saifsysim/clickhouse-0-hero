// ══════════════════════════════════════════════════════════════════════════════
// ClickHouse FAQ — for database engineers exploring ClickHouse
// ══════════════════════════════════════════════════════════════════════════════

(function () {

    const FAQ_SECTIONS = [
        {
            title: '🏗️ Fundamentals',
            qs: [
                {
                    q: 'What exactly is ClickHouse and how is it different from databases I already know?',
                    a: `ClickHouse is an <strong>OLAP (Online Analytical Processing)</strong> database — it's designed to run fast analytical queries over billions of rows, not to handle thousands of tiny transactional reads and writes per second.
<br><br>
The short version: if PostgreSQL is a <em>notebook</em> where you can read and edit any line at any time, ClickHouse is a <em>spreadsheet</em> that can SUM an entire column of 1 billion numbers in under a second — but doesn't want you scribbling in individual cells.
<br><br>
Under the hood, ClickHouse is <strong>columnar</strong>: each column is stored separately on disk, compressed independently. A query like <code>SELECT SUM(views)</code> reads <em>only</em> the <code>views</code> column — not every other column. That's the core performance advantage.`
                },
                {
                    q: 'What is columnar storage and why does it matter so much for analytics?',
                    a: `In a <strong>row-oriented</strong> database (PostgreSQL, MySQL), a row is stored together on disk: <code>[user_id, domain, views, dwell_ms, category]</code>. To compute <code>SUM(views)</code> across 50 million rows, PostgreSQL must load all 50M rows — including every other column — from disk.
<br><br>
In <strong>columnar</strong> storage, columns are stored separately. <code>views.bin</code> lives on its own. <code>SUM(views)</code> reads <em>only</em> <code>views.bin</code> — 1 of 5 columns — and it arrives compressed, so the actual I/O is a fraction of the row-oriented case.
<br><br>
Add SIMD vectorized execution (processing 256/512 bits at a time) and you get queries that run at billions of rows per second on a single machine.`
                },
                {
                    q: 'What is MergeTree and why does every table need it?',
                    a: `MergeTree is ClickHouse's default and most important storage engine. All other engines (ReplacingMergeTree, AggregatingMergeTree, etc.) are built on top of it.
<br><br>
When you INSERT data, ClickHouse writes it as a new <strong>part</strong> — an immutable directory of columnar files. Parts are small and written fast. In the background, ClickHouse <strong>merges</strong> smaller parts into larger ones, applying your ORDER BY sorting as it goes.
<br><br>
<code>ORDER BY (user_id, viewed_at)</code> means all rows for the same <code>user_id</code> are adjacent on disk. A query filtering on <code>user_id = 'u001'</code> reads a tiny fraction of the total data — ClickHouse uses the sort order as a sparse index to skip irrelevant data blocks.`
                },
                {
                    q: 'How does the ORDER BY in ClickHouse differ from an index in PostgreSQL?',
                    a: `PostgreSQL's B-tree index is a <strong>separate structure</strong> — an extra on-disk tree that points at heap pages. Row lookups use the index to find the page, then fetch the full row from the heap.
<br><br>
ClickHouse's ORDER BY is a <strong>physical sort</strong> of the data on disk. There's no separate index to maintain. ClickHouse builds a sparse index (one entry per ~8192 rows) from the ORDER BY columns, then skips directly to the right granule on disk for range queries.
<br><br>
The implication: ClickHouse is extremely fast for range scans on the leading ORDER BY columns, but inefficient for arbitrary-column point lookups — unlike a B-tree where you can index any column.`
                },
                {
                    q: 'What is a "granule" in ClickHouse?',
                    a: `ClickHouse divides each column file into chunks called <strong>granules</strong> — usually 8192 rows each (controlled by <code>index_granularity</code>). The sparse primary index stores the first row of each granule.
<br><br>
When a query filters on the ORDER BY key, ClickHouse reads the sparse index to find which granules might match, then reads only those granules from disk. For a table with 1 billion rows and 8192-row granules, that's ~122,000 index entries — fits in RAM, enables fast skip.`
                },
            ]
        },
        {
            title: '⚙️ Table Engines',
            qs: [
                {
                    q: 'What is ReplacingMergeTree and how do I handle deduplication?',
                    a: `ReplacingMergeTree deduplicates rows with the same ORDER BY key, keeping the row with the highest <code>version</code> (or the last-inserted if no version column is specified). This happens during <strong>background merges</strong>, not immediately on insert.
<br><br>
The gotcha: immediately after an INSERT, both the old and new rows may coexist in different parts. To get deduplicated results <em>now</em>, add <code>FINAL</code> to your query:
<br><code>SELECT * FROM my_table FINAL WHERE …</code>
<br><br>
<code>FINAL</code> does deduplication at query time — slower but consistent. For production reads, many teams add <code>FINAL</code> to reporting queries and rely on background dedup for performance.`
                },
                {
                    q: 'What is AggregatingMergeTree and when should I use it?',
                    a: `AggregatingMergeTree stores <strong>partial aggregate states</strong> (not final numbers) and merges them in the background. It's designed to work with <strong>Materialized Views</strong> to build real-time pre-aggregations.
<br><br>
Instead of storing <code>view_count INT</code>, you store <code>view_count AggregateFunction(count, UInt8)</code> — a binary blob. When querying, <code>countMerge(view_count)</code> finalises the merge across all stored states.
<br><br>
Use it when you want a table that always reflects the current aggregated state of another table, updated automatically on each INSERT, without any cron jobs or ETL pipelines.`
                },
                {
                    q: 'What is a Materialized View in ClickHouse — is it the same as in PostgreSQL?',
                    a: `Very different. In PostgreSQL, a Materialized View is a <strong>snapshot</strong> that you refresh manually or on a schedule with <code>REFRESH MATERIALIZED VIEW</code>.
<br><br>
In ClickHouse, a Materialized View is a <strong>trigger</strong>. It fires on every INSERT into the source table, runs its SELECT on <em>only the new rows</em> (the delta — not the full table), and writes the result into a target table. There is no refresh. There is no cron.
<br><br>
Combined with AggregatingMergeTree, this means your aggregated table updates itself in real time on every write — effectively replacing the entire "scheduled aggregation job" pattern.`
                },
                {
                    q: 'What is SummingMergeTree?',
                    a: `A simplified version of AggregatingMergeTree. Rows with the same ORDER BY key are merged by <strong>summing</strong> their numeric columns. Good for simple counters (event counts, revenue) but inflexible — you can't compute averages or unique counts without extra columns.
<br><br>
For most real-world cases, AggregatingMergeTree + <code>sumState</code>/<code>sumMerge</code> is preferred because it handles multiple aggregate functions and is more explicit.`
                },
                {
                    q: 'What are async inserts and why do they exist?',
                    a: `ClickHouse is optimised for large batch inserts (100k+ rows per query). Each INSERT creates a new part on disk. If you insert thousands of individual rows per second, you'll create thousands of tiny parts — causing background merge storms.
<br><br>
<strong>Async inserts</strong> buffer small incoming inserts in memory (or a queue) and flush them as larger batches. Enable with <code>async_insert=1</code> on the session or connection. ClickHouse returns success to the client immediately after buffering, without waiting for the disk flush.
<br><br>
Use this for browser extension events, IoT sensors, click tracking — any high-frequency, small-batch write pattern.`
                },
                {
                    q: 'What are Dictionaries and when do I use them instead of a JOIN?',
                    a: `A Dictionary is an in-memory key→value lookup table loaded from any source (another ClickHouse table, PostgreSQL, Redis, CSV, HTTP). Access them with <code>dictGet(dictionary_name, attribute, key)</code>.
<br><br>
Instead of <code>JOIN product_catalog ON sku_id = c.sku_id</code> at query time (expensive at scale), you pre-load the catalog into a dictionary and call <code>dictGet('product_dict', 'brand', sku_id)</code> — no join, no shuffle, ~nanosecond lookup per row.
<br><br>
Best for small-to-medium dimensional tables that change infrequently (product catalogs, geo lookups, user segments).`
                },
            ]
        },
        {
            title: '🔎 Queries & SQL',
            qs: [
                {
                    q: 'Does ClickHouse support JOINs?',
                    a: `Yes, ClickHouse supports standard SQL JOINs (INNER, LEFT, RIGHT, FULL, CROSS, ASOF). However, they work differently at scale than in PostgreSQL:
<br><br>
ClickHouse loads the <strong>right-side table</strong> of a JOIN into memory on each node. For large right-side tables this is expensive. Best practices:
<ul>
<li>Put the <strong>larger</strong> table on the left, smaller on the right</li>
<li>Replace frequent small-table JOINs with <strong>Dictionaries</strong></li>
<li>Pre-JOIN with Materialized Views if the join is always the same</li>
<li>Use <code>distributed_product_mode</code> carefully for distributed JOINs</li>
</ul>
JOINs work fine for moderate data. At billions of rows, design your schema to minimize them.`
                },
                {
                    q: 'How do I UPDATE or DELETE rows in ClickHouse?',
                    a: `ClickHouse is <strong>append-optimized</strong> — individual row mutations are expensive and should be rare.
<br><br>
<strong>ALTER TABLE … UPDATE / DELETE</strong> (mutations) — heavy background operation that rewrites entire parts on disk. Commands are asynchronous; they return immediately but run in the background. Not for OLTP patterns.
<br><br>
<strong>Better patterns:</strong>
<ul>
<li><strong>ReplacingMergeTree</strong> — for upserts: insert a new row with a higher version; old rows are deduplicated during merges</li>
<li><strong>CollapsingMergeTree</strong> — insert a cancellation row (sign=-1) + new row (sign=1) to simulate update</li>
<li><strong>Lightweight deletes</strong> (<code>DELETE FROM table WHERE …</code>) — available in recent versions, marks rows as deleted without immediate rewrite</li>
</ul>`
                },
                {
                    q: 'What is FINAL and when should I use it?',
                    a: `<code>FINAL</code> forces ClickHouse to perform deduplication at <strong>query time</strong> for ReplacingMergeTree tables. Without FINAL, you may see duplicate rows that haven't been merged yet in the background.
<br><br>
<code>SELECT * FROM orders FINAL WHERE order_id = 123</code>
<br><br>
Performance impact: FINAL reads and merges parts in memory, which can be slow on large tables. Optimise by adding <code>WHERE</code> filters on the ORDER BY key — FINAL only needs to process the relevant data range.
<br><br>
For analytics (GROUP BY, COUNT), you often don't need FINAL if duplicates are tolerable in intermediate states.`
                },
                {
                    q: 'What does LowCardinality do and when should I use it?',
                    a: `<code>LowCardinality(String)</code> applies <strong>dictionary encoding</strong> — ClickHouse builds an internal dictionary mapping each unique string value to an integer, then stores integers instead of strings. This drastically reduces storage for columns with few unique values.
<br><br>
<strong>Use it when:</strong> <br>— A String column has fewer than ~10,000 unique values (category, country, status, device_type)<br>— The column is frequently used in GROUP BY or WHERE
<br><br>
<strong>Don't use it for:</strong> high-cardinality columns (URLs, user IDs, UUIDs) — the dictionary overhead negates the benefit.`
                },
                {
                    q: 'What is countIf, sumIf and how are they faster than a subquery?',
                    a: `ClickHouse's conditional aggregate functions let you compute multiple aggregations in a <strong>single pass</strong> over the data:
<br><pre>SELECT
  countIf(event = 'view')   AS views,
  countIf(event = 'click')  AS clicks,
  countIf(event = 'buy')    AS purchases
FROM events</pre>
Equivalent to three separate subqueries, but reads the data <em>once</em>. In a columnar engine reading a single column this is enormously efficient — a full funnel analysis in one scan.`
                },
                {
                    q: 'How does PARTITION BY differ from ORDER BY?',
                    a: `They operate at different levels:
<br><br>
<strong>ORDER BY</strong> — sorts data <em>within</em> a part. Controls the sparse index, determines how fast range queries on those columns are. Every MergeTree table must have an ORDER BY.
<br><br>
<strong>PARTITION BY</strong> — splits data into separate directories on disk by a value (usually a date: <code>toYYYYMM(event_date)</code>). A query with <code>WHERE event_date >= '2024-01-01'</code> skips entire partitions that don't match — before even reading the sparse index.
<br><br>
Partitioning is powerful for time-series data. Common pattern: <code>PARTITION BY toYYYYMM(date)</code>, <code>ORDER BY (user_id, date)</code>.`
                },
                {
                    q: 'What is an ASOF JOIN and when would I use it?',
                    a: `ASOF JOIN joins each row from the left table with the <strong>most recent preceding row</strong> from the right table — a "time-series join."
<br><br>
<strong>Example:</strong> join user events to the exchange rate that was active <em>at the time</em> of each event:
<br><code>FROM events ASOF JOIN exchange_rates USING (currency, event_time)</code>
<br><br>
ClickHouse will match each event with the latest exchange rate row where <code>rate_time &lt;= event_time</code>. This is famously awkward in SQL and usually requires window functions or lateral joins — ASOF makes it a one-liner.`
                },
                {
                    q: 'How does ClickHouse handle NULL values? Are there gotchas?',
                    a: `By default, ClickHouse columns are <strong>NOT NULL</strong> — they store a default value (0 for numbers, empty string for strings) instead of a null. This is intentional for performance: null bitmaps add overhead.
<br><br>
To allow nulls, declare the column as <code>Nullable(UInt32)</code>. However, Nullable columns have slightly lower performance (extra null bitmap per column) and cannot be used in the ORDER BY key.
<br><br>
Common gotcha: if you insert a NULL into a non-Nullable column, ClickHouse silently converts it to the default value (0 or ''). Always declare Nullable explicitly if you need real null semantics.`
                },
            ]
        },
        {
            title: '🚀 Performance & Scaling',
            qs: [
                {
                    q: 'How does ClickHouse actually achieve such fast query speeds?',
                    a: `Multiple layers working together:
<ul>
<li><strong>Columnar storage</strong> — read only the columns you need</li>
<li><strong>Compression</strong> — LZ4 or ZSTD per column, columns compress better than rows (similar values adjacent). Typical 5–10× compression on real data.</li>
<li><strong>Sparse index</strong> — skip entire granules (8192 rows) of irrelevant data</li>
<li><strong>Vectorized execution</strong> — process 256–512 bits of data per CPU instruction (SIMD). ClickHouse generates code (JIT) optimised for your specific query at runtime.</li>
<li><strong>Parallel execution</strong> — a single query uses all CPU cores automatically</li>
<li><strong>Pre-aggregation</strong> — AggMT + MVs reduce query-time work to merging pre-computed states</li>
</ul>`
                },
                {
                    q: 'When should I NOT use ClickHouse?',
                    a: `ClickHouse is the wrong tool if:
<ul>
<li>You need <strong>ACID transactions</strong> (multi-row commits, rollbacks, isolation levels)</li>
<li>You do frequent <strong>single-row UPDATE/DELETE</strong> — use PostgreSQL for OLTP</li>
<li>Your queries are dominated by <strong>PK lookups</strong> (user profile fetches, order status checks) — use Cassandra or DynamoDB</li>
<li>You need <strong>full-text search</strong> with relevance ranking — use Elasticsearch</li>
<li>Your data volume is small (&lt;10M rows) — the overhead of columnar design doesn't pay off; PostgreSQL is simpler</li>
<li>You need complex <strong>many-to-many JOINs</strong> — ClickHouse is not a relational database</li>
</ul>`
                },
                {
                    q: 'Can ClickHouse replace my PostgreSQL entirely?',
                    a: `Not as a drop-in replacement, but many teams run both:
<br><br>
<strong>PostgreSQL</strong> handles: user accounts, orders, product catalog, any data needing ACID transactions and complex JOINs.
<br><br>
<strong>ClickHouse</strong> handles: analytics, dashboards, event tracking, aggregations, time-series — any query that would be "too slow" in Postgres.
<br><br>
Data typically flows from PostgreSQL → ClickHouse via CDC (Change Data Capture) tools like Debezium, or via direct bulk inserts. The two systems have complementary strengths, not overlapping ones.`
                },
                {
                    q: 'How does ClickHouse scale horizontally?',
                    a: `ClickHouse scales through <strong>sharding</strong>. You create a <em>local</em> table (MergeTree) on each node, then a <em>Distributed</em> table on top that routes queries and inserts across all shards.
<br><br>
Inserts go to one shard (or all, depending on config). Queries are executed in parallel on all shards; results are assembled on the initiator node.
<br><br>
Replication is handled separately via <strong>ReplicatedMergeTree</strong>, which uses ClickHouse Keeper (or ZooKeeper) to coordinate part metadata across replicas.
<br><br>
ClickHouse Cloud handles all of this automatically — you don't manage shards or replicas.`
                },
                {
                    q: 'What is the typical schema design mistake that kills ClickHouse performance?',
                    a: `The most common mistake is choosing the wrong ORDER BY key.
<br><br>
<strong>Bad:</strong> <code>ORDER BY (id)</code> — ID is usually a random UUID or auto-increment. Queries filtering on domain, user, or time get no benefit from the sparse index and do full scans.
<br><br>
<strong>Better:</strong> <code>ORDER BY (user_id, domain, toStartOfHour(viewed_at))</code> — queries filtering on user + domain skip the vast majority of data.
<br><br>
General rules:
<ul>
<li>Put the most-filtered column first</li>
<li>Put time <em>after</em> high-cardinality dimensions for analytics (or use PARTITION BY for time)</li>
<li>Keep ORDER BY columns to 3–5 max; more doesn't improve filtering and slows merges</li>
</ul>`
                },
                {
                    q: 'How does ClickHouse compression work and what should I configure?',
                    a: `ClickHouse compresses each column file independently. The default codec is <strong>LZ4</strong> (fast, moderate compression). You can override per-column:
<pre>CREATE TABLE events (
  viewed_at DateTime  CODEC(Delta, ZSTD),    -- great for timestamps
  views     UInt32    CODEC(Delta, LZ4),      -- great for monotonic ints
  domain    LowCardinality(String)             -- dictionary encodes first
)</pre>
<strong>Delta codec</strong> stores differences between successive values — enormously effective for sorted timestamps or monotonic integers (compression of 10–50× on timestamp columns).
<br><br>
<strong>ZSTD</strong> gives better compression ratios than LZ4 at the cost of slightly more CPU. Use ZSTD for cold/archive data, LZ4 for hot analytical data.`
                },
                {
                    q: 'My ClickHouse query is slow — where do I start debugging?',
                    a: `<ol>
<li><strong>Use EXPLAIN</strong>: <code>EXPLAIN PIPELINE SELECT …</code> to see whether ClickHouse is doing a full scan or using the sparse index</li>
<li><strong>Check system.query_log</strong>: <code>SELECT query, read_rows, read_bytes, query_duration_ms FROM system.query_log ORDER BY query_start_time DESC LIMIT 20</code></li>
<li><strong>Is it reading too many rows?</strong> The sparse index isn't being used — check that your WHERE clause matches leading ORDER BY columns</li>
<li><strong>Is it reading too many columns?</strong> Add a projection or remove unnecessary SELECT columns</li>
<li><strong>Is it doing a hash JOIN with a large right table?</strong> Move the smaller table to the right, or use a Dictionary</li>
<li><strong>High read_bytes but fast?</strong> Compression is working. High read_rows + slow? Schema or ORDER BY mismatch.</li>
</ol>`
                },
            ]
        },
        {
            title: '🛠️ Operations & Ecosystem',
            qs: [
                {
                    q: 'Does ClickHouse support ACID transactions?',
                    a: `No, not in the traditional sense. ClickHouse prioritises throughput and analytical query speed over transactional consistency.
<br><br>
What it <em>does</em> provide:
<ul>
<li>Single INSERT is atomic (either the whole block lands or it doesn't)</li>
<li>ReplicatedMergeTree provides eventual consistency across replicas</li>
<li>Lightweight deletes are available in recent versions</li>
</ul>
What it does <em>not</em> provide: multi-statement transactions, row-level locking, isolation levels, rollback.
<br><br>
If your use case requires ACID, use PostgreSQL for the transactional part and sync to ClickHouse for analytics.`
                },
                {
                    q: 'How does ClickHouse handle schema migrations?',
                    a: `Much simpler than PostgreSQL for most operations:
<ul>
<li><code>ALTER TABLE ADD COLUMN</code> — instant, no data rewrite. New column defaults to type default (0, ''). Existing parts are not touched.</li>
<li><code>ALTER TABLE MODIFY COLUMN</code> — converts existing data, may involve rewrite</li>
<li><code>ALTER TABLE DROP COLUMN</code> — marks column as deleted, cleaned up during merges</li>
<li><code>ALTER TABLE RENAME COLUMN</code> — instant metadata change</li>
</ul>
Gotcha: ClickHouse replicates DDL across all replicas via ZooKeeper/Keeper. Use <code>ON CLUSTER cluster_name</code> for distributed tables.`
                },
                {
                    q: 'What is ClickHouse Keeper and do I need ZooKeeper?',
                    a: `ClickHouse Keeper is ClickHouse's built-in replacement for ZooKeeper — same protocol, but implemented in C++ and bundled with ClickHouse. It manages ReplicatedMergeTree metadata: which parts exist, what's been inserted, merge coordination.
<br><br>
<strong>Modern recommendation:</strong> use ClickHouse Keeper (deploy it as a separate 3-node quorum) instead of ZooKeeper. It's simpler to operate and has lower latency.
<br><br>
For single-node or ClickHouse Cloud setups, you don't need to worry about this at all.`
                },
                {
                    q: 'How does ClickHouse compare to BigQuery, Redshift, and Snowflake?',
                    a: `All four are columnar analytical databases. The key differences:
<br><br>
<table style="font-size:10px;width:100%;border-collapse:collapse">
<tr style="background:rgba(255,255,255,.05)"><th style="padding:4px 8px;text-align:left">Dimension</th><th style="padding:4px 8px">ClickHouse</th><th style="padding:4px 8px">BigQuery</th><th style="padding:4px 8px">Redshift</th><th style="padding:4px 8px">Snowflake</th></tr>
<tr><td style="padding:4px 8px">Deployment</td><td style="padding:4px 8px">Self-hosted or Cloud</td><td style="padding:4px 8px">GCP-only</td><td style="padding:4px 8px">AWS-only</td><td style="padding:4px 8px">Multi-cloud</td></tr>
<tr><td style="padding:4px 8px">Latency</td><td style="padding:4px 8px">Sub-second</td><td style="padding:4px 8px">Seconds</td><td style="padding:4px 8px">Seconds</td><td style="padding:4px 8px">Seconds</td></tr>
<tr><td style="padding:4px 8px">Real-time</td><td style="padding:4px 8px">Yes (MV + AggMT)</td><td style="padding:4px 8px">Streaming load</td><td style="padding:4px 8px">Limited</td><td style="padding:4px 8px">Dynamic tables</td></tr>
<tr><td style="padding:4px 8px">Cost model</td><td style="padding:4px 8px">Compute hours</td><td style="padding:4px 8px">Per bytes scanned</td><td style="padding:4px 8px">Cluster hours</td><td style="padding:4px 8px">Credits</td></tr>
<tr><td style="padding:4px 8px">SQL dialect</td><td style="padding:4px 8px">ClickHouse SQL</td><td style="padding:4px 8px">Standard SQL</td><td style="padding:4px 8px">PostgreSQL-ish</td><td style="padding:4px 8px">Standard SQL</td></tr>
</table>
<br>ClickHouse excels at sub-second latency and self-hosted deployments. BigQuery/Snowflake win on ecosystem and SQL compatibility. Redshift is deeply integrated with AWS.`
                },
                {
                    q: 'What are system tables and why are they useful?',
                    a: `ClickHouse ships with a rich set of built-in observability tables under the <code>system</code> database:
<br><br>
<ul>
<li><code>system.query_log</code> — full history of every query: duration, read rows, read bytes, memory used. Your first debugging stop.</li>
<li><code>system.parts</code> — every part on disk for every table: rows, bytes, compressed size, creation time. Spot when merges aren't keeping up.</li>
<li><code>system.merges</code> — in-progress background merges.</li>
<li><code>system.tables</code> — table metadata, engine, partition key.</li>
<li><code>system.columns</code> — column metadata and compression codecs.</li>
<li><code>system.asynchronous_insert_log</code> — async insert queue state.</li>
</ul>
These replace most of what you'd need an external monitoring tool for.`
                },
                {
                    q: 'How do I back up ClickHouse data?',
                    a: `ClickHouse supports first-class backup/restore via SQL:
<br><pre>-- Backup to local disk
BACKUP TABLE my_db.events TO Disk('backups', '2024-01-backup.zip');

-- Restore
RESTORE TABLE my_db.events FROM Disk('backups', '2024-01-backup.zip');</pre>
Also supports S3, GCS, and Azure Blob as backup destinations (ClickHouse Cloud handles this automatically).
<br><br>
For replication-based setups, replicas act as live copies — losing one node doesn't lose data.`
                },
                {
                    q: 'What ingestion patterns work best with ClickHouse?',
                    a: `<table style="font-size:10px;width:100%;border-collapse:collapse">
<tr style="background:rgba(255,255,255,.05)"><th style="padding:4px 8px">Pattern</th><th style="padding:4px 8px">Best Tool</th><th style="padding:4px 8px">Notes</th></tr>
<tr><td style="padding:4px 8px">Kafka / Kinesis</td><td style="padding:4px 8px">Kafka Table Engine / ClickPipes</td><td style="padding:4px 8px">Native consumer, reads topics into CHtables</td></tr>
<tr><td style="padding:4px 8px">PostgreSQL CDC</td><td style="padding:4px 8px">Debezium + Kafka</td><td style="padding:4px 8px">Capture changes, stream to ClickHouse</td></tr>
<tr><td style="padding:4px 8px">App events</td><td style="padding:4px 8px">Async inserts (HTTP)</td><td style="padding:4px 8px">Fire-and-forget from backend or browser extension</td></tr>
<tr><td style="padding:4px 8px">Batch ETL</td><td style="padding:4px 8px">INSERT SELECT or file ingest</td><td style="padding:4px 8px">CSV, Parquet, JSON natively supported</td></tr>
<tr><td style="padding:4px 8px">S3 / GCS</td><td style="padding:4px 8px">s3() table function</td><td style="padding:4px 8px">Query Parquet/CSV files directly from S3</td></tr>
</table>`
                },
            ]
        },
    ];

    // ── Render ───────────────────────────────────────────────────────────────────
    function renderFaq() {
        return `
      <div class="faq-hero">
        <div class="faq-hero-title">ClickHouse FAQ</div>
        <div class="faq-hero-sub">Common questions from database engineers exploring ClickHouse — covering fundamentals, table engines, queries, performance, and operations.</div>
        <div class="faq-stat-row">
          <span class="faq-stat">${FAQ_SECTIONS.reduce((t, s) => t + s.qs.length, 0)} questions answered</span>
          <span class="faq-stat">${FAQ_SECTIONS.length} topics covered</span>
          <span class="faq-stat">Assumes you know SQL &amp; databases</span>
        </div>
      </div>

      <div class="faq-toc">
        ${FAQ_SECTIONS.map((s, si) => `
          <a class="faq-toc-link" href="#faq-section-${si}">${s.title}</a>
        `).join('')}
      </div>

      ${FAQ_SECTIONS.map((section, si) => `
        <div class="faq-section" id="faq-section-${si}">
          <div class="faq-section-title">${section.title}</div>
          ${section.qs.map((item, qi) => `
            <div class="faq-item" id="faq-${si}-${qi}">
              <button class="faq-q" onclick="faqToggle(${si},${qi})" aria-expanded="false">
                <span class="faq-q-text">${item.q}</span>
                <span class="faq-chevron">›</span>
              </button>
              <div class="faq-a" id="faq-a-${si}-${qi}">
                <div class="faq-a-inner">${item.a}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
    }

    window.faqToggle = function (si, qi) {
        const btn = document.getElementById(`faq-${si}-${qi}`).querySelector('.faq-q');
        const body = document.getElementById(`faq-a-${si}-${qi}`);
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', !open);
        body.style.maxHeight = open ? '0' : body.scrollHeight + 'px';
        body.style.opacity = open ? '0' : '1';
    };

    window.initFaqPage = function () {
        const root = document.getElementById('faq-root');
        if (!root || root.dataset.loaded) return;
        root.innerHTML = renderFaq();
        root.dataset.loaded = 'true';
    };
})();
