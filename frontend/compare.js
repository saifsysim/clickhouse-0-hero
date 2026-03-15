// ══════════════════════════════════════════════════════════════════════════════
// ClickHouse vs The World — comparison page
// ══════════════════════════════════════════════════════════════════════════════

(function () {
  // ── Data ─────────────────────────────────────────────────────────────────────
  const DATABASES = [
    { id: 'pg', label: 'PostgreSQL', icon: '🐘', color: '#3b82f6', tagline: 'Row-oriented OLTP' },
    { id: 'dynamo', label: 'DynamoDB', icon: '⚡', color: '#f97316', tagline: 'Key-value / document' },
    { id: 'elastic', label: 'Elasticsearch', icon: '🔍', color: '#f59e0b', tagline: 'Inverted-index search' },
    { id: 'cassandra', label: 'Cassandra', icon: '💍', color: '#a855f7', tagline: 'Wide-column / write-heavy' },
  ];

  const CATEGORIES = [
    { id: 'storage', label: '🗄️ Storage Model', },
    { id: 'query', label: '🔎 Query Strengths', },
    { id: 'writes', label: '✍️ Write Patterns', },
    { id: 'scale', label: '📈 Scalability', },
    { id: 'aggr', label: '⚙️ Aggregation', },
    { id: 'schema', label: '📐 Schema & Types', },
    { id: 'realtime', label: '⚡ Real-time', },
    { id: 'ops', label: '🛠️ Operations', },
    { id: 'usecase', label: '🎯 Best For', },
    { id: 'notfor', label: '🚫 Not For', },
  ];

  // rows: [clickhouse, pg, dynamo, elastic, cassandra]
  const ROWS = {
    storage: [
      { val: 'Columnar — stores each column as a separate file on disk. Only reads columns the query needs.', score: 5 },
      { val: 'Row-oriented — every read fetches full rows even for single-column aggregations.', score: 2 },
      { val: 'Schemaless documents stored row-wise on SSD with B-tree indexes per table.', score: 2 },
      { val: 'Inverted index (Lucene segments). Documents stored as JSON blobs per segment.', score: 2 },
      { val: 'Wide-column (SSTable / LSM-tree). Rows partitioned by partition key + clustering key.', score: 3 },
    ],
    query: [
      { val: 'Aggregation, GROUP BY, window functions, time-series, full-table scans at billions-per-second.', score: 5 },
      { val: 'Complex JOINs, transactions, PK lookups, referential integrity, OLTP workloads.', score: 4 },
      { val: 'Single-item PK/SK lookups, small range scans with GSI. Terrible for aggregations.', score: 2 },
      { val: 'Full-text search, fuzzy match, geo-search, faceted filtering. Weak at aggregations over millions of docs.', score: 3 },
      { val: 'Partition-key reads, time-series scans within a partition. Strong consistency within partition.', score: 3 },
    ],
    writes: [
      { val: 'Batch inserts preferred — ClickHouse buffers and merges parts in background. Async inserts buffer small writes.', score: 3 },
      { val: 'Excellent single-row INSERT/UPDATE/DELETE with ACID transactions and WAL.', score: 5 },
      { val: 'Sub-millisecond single-item writes (PutItem). Handles millions of TPS via provisioned/on-demand capacity.', score: 5 },
      { val: 'Near-real-time index updates via LSM segments. Frequent small writes cause segment merge overhead.', score: 3 },
      { val: 'Extremely write-optimized. LSM tree absorbs millions of writes/s with no read impact. Best-in-class.', score: 5 },
    ],
    scale: [
      { val: 'Horizontal sharding via distributed tables across shards. Reads scale linearly. No cross-shard transactions.', score: 4 },
      { val: 'Vertical scale well. Horizontal requires Citus/partitioning. JOINs across shards are painful.', score: 3 },
      { val: 'Fully serverless auto-scaling. No server management. Scales to any TPS automatically.', score: 5 },
      { val: 'Auto-scales with shard allocation. Coordinating nodes can become bottleneck at very high query rates.', score: 3 },
      { val: 'Linearly scalable reads and writes by adding nodes. No single point of failure. Multi-datacenter native.', score: 5 },
    ],
    aggr: [
      { val: 'Purpose-built. AggregatingMergeTree + Materialized Views for real-time pre-aggregation. countMerge, sumMerge, uniqMerge. Vectorized execution SIMD.', score: 5 },
      { val: 'Standard SQL aggregates (SUM, COUNT, AVG, PERCENTILE_CONT). Slow on large tables — requires full row reads.', score: 3 },
      { val: 'Very limited. Requires scanning all matching items. No true columnar aggregation. Use Athena/Redshift instead.', score: 1 },
      { val: 'Bucket aggregations (terms, date_histogram, stats). Useful for dashboards but memory-hungry at scale.', score: 3 },
      { val: 'Very limited aggregation support. COUNT(*) requires full partition scan. No SUM, AVG without client-side logic.', score: 1 },
    ],
    schema: [
      { val: 'Strict typed schema required. Rich types: LowCardinality, FixedString, Nested, Map, Array, Enum. Types matter a lot for performance.', score: 4 },
      { val: 'Rich schema with constraints, ENUMs, JSONB, arrays, foreign keys. Schema migrations can be slow on large tables.', score: 5 },
      { val: 'Schemaless — only partition key and sort key are required. All other attributes are free-form. Great flexibility.', score: 5 },
      { val: 'Schemaless — mappings define field types but new fields can be added dynamically to documents.', score: 4 },
      { val: 'Schema required for table/column families. ALTER TABLE is online but schema changes need careful planning.', score: 3 },
    ],
    realtime: [
      { val: 'Near real-time ingestion via async inserts (seconds). Materialized Views update on each INSERT — no cron needed. Query latency: sub-50ms.', score: 4 },
      { val: 'Real-time for small row reads. Analytical queries over millions of rows are slow — not designed for streaming aggregation.', score: 2 },
      { val: 'Items available immediately after write. DynamoDB Streams for change data capture. No query-time aggregation.', score: 4 },
      { val: 'Documents indexed within ~1s (near real-time). Good for search dashboards. Aggregation over large indices slows.', score: 4 },
      { val: 'Writes available immediately after quorum. Excellent for high-frequency time-series data. No aggregation.', score: 4 },
    ],
    ops: [
      { val: 'Self-hosted or ClickHouse Cloud (fully managed). Monitoring via system tables. Backups via BACKUP/RESTORE SQL commands.', score: 3 },
      { val: 'Self-hosted (complex) or RDS/Aurora (easy). Mature tooling (pgAdmin, Flyway, pg_dump). WAL archiving for PITR.', score: 5 },
      { val: 'Zero ops — fully managed by AWS. No servers, no backups to configure, no version upgrades.', score: 5 },
      { val: 'Elastic Cloud (easy) or self-hosted (complex). ILM policies for data tiering. Snapshot/restore for backups.', score: 4 },
      { val: 'Self-hosted via Kubernetes or DataStax Astra (managed). nodetool for ops. Compaction tuning is an art.', score: 3 },
    ],
    usecase: [
      { val: 'Analytics, dashboards, event tracking, time-series, log aggregation, personalization feeds, A/B testing results, billing analytics.', score: null },
      { val: 'Web app backends, user data, transactional workflows, reporting on moderate data, anything needing JOINs + ACID.', score: null },
      { val: 'User sessions, shopping carts, feature flags, leaderboards, gaming state, any workload needing sub-ms PK lookups at scale.', score: null },
      { val: 'Search autocomplete, e-commerce product search, log search, geo search, anything full-text or fuzzy-match.', score: null },
      { val: 'IoT time-series, messaging inboxes, activity feeds, write-heavy workloads with predictable access patterns.', score: null },
    ],
    notfor: [
      { val: 'Transactional workloads, frequent single-row updates/deletes, complex JOIN-heavy OLTP, low-latency PK lookups.', score: null },
      { val: 'Analytical queries over millions of rows, event aggregation, time-series with flexible dimensions.', score: null },
      { val: 'Any aggregation, complex filtering, full-text search, or analytical workloads — requires exporting data first.', score: null },
      { val: 'Aggregations over hundreds of millions of documents, transactional writes, complex multi-field analytics.', score: null },
      { val: 'Ad-hoc analytics, complex aggregations, full-text search, anything requiring flexible secondary indexes.', score: null },
    ],
  };

  const DECISION_ROWS = [
    ['You need sub-second aggregations over 100M+ rows', 'ch'],
    ['You need ACID transactions with JOINs', 'pg'],
    ['You need sub-millisecond PK lookups at millions of TPS', 'dynamo'],
    ['You need full-text or fuzzy search', 'elastic'],
    ['You need to ingest millions of writes per second', 'cassandra'],
    ['You want real-time pre-aggregated dashboards without crons', 'ch'],
    ['You need geospatial search', 'elastic'],
    ['You have IoT time-series with predictable partition keys', 'cassandra'],
    ['You need a serverless, zero-ops data store', 'dynamo'],
    ['You want flexible SQL across your entire data', 'pg'],
    ['You need event tracking + instant analytics', 'ch'],
    ['You need deduplication with upserts at scale', 'ch'],
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  function scoreBar(score) {
    if (score == null) return '';
    const colors = ['', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#10b981'];
    const w = score * 20;
    return `<div style="margin-top:4px;height:3px;border-radius:2px;background:rgba(255,255,255,.06);width:100%">
      <div style="height:3px;border-radius:2px;width:${w}%;background:${colors[score]};transition:width .4s"></div></div>`;
  }

  function dbBadge(db) {
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${db.color}22;border:1px solid ${db.color}44;color:${db.color}">${db.icon} ${db.label}</span>`;
  }

  function renderTable(catId) {
    const rowData = ROWS[catId];
    const cat = CATEGORIES.find(c => c.id === catId);
    return `
      <div class="cmp-table-wrap">
        <table class="cmp-table">
          <thead>
            <tr>
              <th class="cmp-th cmp-th-db">Database</th>
              <th class="cmp-th">Approach</th>
            </tr>
          </thead>
          <tbody>
            <tr class="cmp-row cmp-row-ch">
              <td class="cmp-td-db"><span class="cmp-ch-badge">⚡ ClickHouse</span></td>
              <td class="cmp-td">${rowData[0].val}${scoreBar(rowData[0].score)}</td>
            </tr>
            ${DATABASES.map((db, i) => `
            <tr class="cmp-row">
              <td class="cmp-td-db">${dbBadge(db)}</td>
              <td class="cmp-td">${rowData[i + 1].val}${scoreBar(rowData[i + 1].score)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderDecisionGuide() {
    const dbMap = Object.fromEntries(DATABASES.map(d => [d.id, d]));
    return `
      <div class="cmp-section-title">🎯 Decision Guide — Which Database Should I Use?</div>
      <div class="cmp-decision-wrap">
        ${DECISION_ROWS.map(([q, winner]) => {
      const isCH = winner === 'ch';
      const db = isCH ? null : dbMap[winner];
      const badge = isCH
        ? `<span class="cmp-ch-badge" style="white-space:nowrap">⚡ ClickHouse</span>`
        : `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${db.color}22;border:1px solid ${db.color}44;color:${db.color};white-space:nowrap">${db.icon} ${db.label}</span>`;
      return `
          <div class="cmp-decision-row">
            <div class="cmp-decision-q">${q}</div>
            <div class="cmp-decision-a">${badge}</div>
          </div>`;
    }).join('')}
      </div>`;
  }

  function renderHero() {
    return `
      <div class="cmp-hero">
        <div class="cmp-hero-title">ClickHouse vs The World</div>
        <div class="cmp-hero-sub">A dimension-by-dimension comparison of how ClickHouse differs from PostgreSQL, DynamoDB, Elasticsearch, and Cassandra — in storage model, query patterns, write throughput, aggregation, and more.</div>
        <div class="cmp-db-pills">
          <div class="cmp-ch-pill">⚡ ClickHouse</div>
          ${DATABASES.map(db => `<div class="cmp-db-pill" style="border-color:${db.color}44;color:${db.color}">${db.icon} ${db.label}<br><small style="opacity:.6;font-size:9px;font-weight:400">${db.tagline}</small></div>`).join('')}
        </div>
      </div>`;
  }

  function renderPage(activeCat) {
    return `
      <div id="cmp-root">
        ${renderHero()}

        <div class="cmp-cat-nav">
          ${CATEGORIES.map(c => `
            <button class="cmp-cat-btn ${c.id === activeCat ? 'cmp-cat-active' : ''}"
              onclick="cmpSwitch('${c.id}')">${c.label}</button>`).join('')}
        </div>

        <div id="cmp-content" class="cmp-content-anim">
          ${renderTable(activeCat)}
        </div>

        ${renderDecisionGuide()}

        <div class="cmp-section-title" style="margin-top:32px">🧠 Core Architectural Difference — How Each Database Stores Data</div>
        <div class="cmp-arch-all">

          <!-- ClickHouse -->
          <div class="cmp-arch-card cmp-arch-card-ch">
            <div class="cmp-arch-db-hdr"><span class="cmp-ch-badge">⚡ ClickHouse</span><span class="cmp-arch-engine-tag">Columnar MergeTree</span></div>
            <div class="cmp-arch-desc">Each column lives in its own compressed file. A query touching only <code>views</code> reads <strong>1 of 5 columns</strong> — 80% less I/O. MergeTree parts are merged in the background.</div>
            <div class="cmp-arch-diagram">
              <div class="cmp-arch-col-grid">
                ${['user_id', 'domain', 'views', 'dwell_ms', 'category'].map((col, ci) => `
                  <div class="cmp-arch-col-block ${ci === 2 ? 'cmp-arch-col-hl' : ''}">
                    <div class="cmp-arch-col-hdr">${col}${ci === 2 ? ' ← read' : ''}</div>
                    <div class="cmp-arch-col-vals"><div>u001</div><div>u002</div><div>u003</div></div>
                  </div>`).join('')}
              </div>
              <div class="cmp-arch-note" style="color:#10b981">✅ SELECT SUM(views) reads only the views column — 5× less I/O, vectorized SIMD</div>
            </div>
            <div class="cmp-arch-tag-row">
              <span class="cmp-arch-tag cmp-arch-tag-good">Columnar compression</span>
              <span class="cmp-arch-tag cmp-arch-tag-good">MergeTree parts</span>
              <span class="cmp-arch-tag cmp-arch-tag-good">Background merge</span>
            </div>
          </div>

          <!-- PostgreSQL -->
          <div class="cmp-arch-card" style="border-color:rgba(59,130,246,.2)">
            <div class="cmp-arch-db-hdr"><span style="color:#3b82f6;font-weight:800">🐘 PostgreSQL</span><span class="cmp-arch-engine-tag">Heap file + B-tree index</span></div>
            <div class="cmp-arch-desc">Rows are stored together in <strong>heap pages</strong> (8KB each). A B-tree index lets you jump to the right page for PK lookups. Aggregations must read every column of every matching row.</div>
            <div class="cmp-arch-diagram">
              <div class="cmp-arch-pg-pages">
                ${[0, 1, 2].map(p => `
                <div class="cmp-arch-pg-page">
                  <div class="cmp-arch-pg-hdr">Page ${p}</div>
                  ${['u00' + (p * 3 + 1), 'u00' + (p * 3 + 2), 'u00' + (p * 3 + 3)].map(u => `
                  <div class="cmp-arch-pg-row">
                    <span class="cmp-arch-pg-col">${u}</span>
                    <span class="cmp-arch-pg-col">amazon</span>
                    <span class="cmp-arch-pg-col cmp-arch-hl-warn">108</span>
                    <span class="cmp-arch-pg-col">62s</span>
                    <span class="cmp-arch-pg-col">Elec</span>
                  </div>`).join('')}
                </div>`).join('')}
              </div>
              <div class="cmp-arch-note" style="color:#f97316">⚠️ SUM(views) fetches full rows from each heap page — all 5 columns read</div>
            </div>
            <div class="cmp-arch-tag-row">
              <span class="cmp-arch-tag cmp-arch-tag-good">ACID transactions</span>
              <span class="cmp-arch-tag cmp-arch-tag-good">B-tree index</span>
              <span class="cmp-arch-tag cmp-arch-tag-warn">Full row read</span>
            </div>
          </div>

          <!-- DynamoDB -->
          <div class="cmp-arch-card" style="border-color:rgba(249,115,22,.2)">
            <div class="cmp-arch-db-hdr"><span style="color:#f97316;font-weight:800">⚡ DynamoDB</span><span class="cmp-arch-engine-tag">Hash-partitioned key-value</span></div>
            <div class="cmp-arch-desc">Items are hashed by <strong>Partition Key (PK)</strong> onto a storage node. Optional Sort Key (SK) creates a range within the partition. Items are schemaless JSON blobs — no column structure.</div>
            <div class="cmp-arch-diagram">
              <div class="cmp-arch-dynamo">
                ${[['user_001', '2024-01-01'], ['user_001', '2024-01-02'], ['user_002', '2024-01-01']].map(([pk, sk], i) => `
                <div class="cmp-arch-dynamo-item" style="animation-delay:${i * .1}s">
                  <div class="cmp-arch-dynamo-pk">PK: ${pk}</div>
                  <div class="cmp-arch-dynamo-sk">SK: ${sk}</div>
                  <div class="cmp-arch-dynamo-attrs">{ views: 108, dwell: 62, … }</div>
                </div>`).join('')}
                <div class="cmp-arch-dynamo-gsi">GSI (Global Secondary Index) ↗</div>
              </div>
              <div class="cmp-arch-note" style="color:#ef4444">🚫 No SUM(views) across partitions — must scan all partitions client-side</div>
            </div>
            <div class="cmp-arch-tag-row">
              <span class="cmp-arch-tag cmp-arch-tag-good">Sub-ms PK lookups</span>
              <span class="cmp-arch-tag cmp-arch-tag-good">Serverless scale</span>
              <span class="cmp-arch-tag cmp-arch-tag-bad">No aggregation</span>
            </div>
          </div>

          <!-- Elasticsearch -->
          <div class="cmp-arch-card" style="border-color:rgba(245,158,11,.2)">
            <div class="cmp-arch-db-hdr"><span style="color:#f59e0b;font-weight:800">🔍 Elasticsearch</span><span class="cmp-arch-engine-tag">Inverted index (Lucene)</span></div>
            <div class="cmp-arch-desc">Documents are stored as JSON. For every field, Elasticsearch builds an <strong>inverted index</strong> — a map from token → list of document IDs. Full-text queries are O(log n). Aggregations require loading doc values (columnar cache).</div>
            <div class="cmp-arch-diagram">
              <div class="cmp-arch-es">
                <div class="cmp-arch-es-section">
                  <div class="cmp-arch-es-hdr">Inverted Index (domain field)</div>
                  ${[['amazon', ['doc1', 'doc4', 'doc9']], ['walmart', ['doc2', 'doc7']], ['ebay', ['doc3', 'doc5', 'doc6']]].map(([term, docs]) => `
                  <div class="cmp-arch-es-row">
                    <span class="cmp-arch-es-term">${term}</span>
                    <span class="cmp-arch-es-docs">${docs.join(' ')}</span>
                  </div>`).join('')}
                </div>
                <div class="cmp-arch-es-section" style="margin-top:8px">
                  <div class="cmp-arch-es-hdr">Doc Values (views field — columnar cache)</div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap">
                    ${[108, 99, 87, 104, 92, 88, 101, 97, 83, 110].map(v => `<span class="cmp-arch-es-val">${v}</span>`).join('')}
                  </div>
                </div>
              </div>
              <div class="cmp-arch-note" style="color:#f59e0b">⚡ Search is instant via inverted index. Aggregations use doc values but degrade at scale.</div>
            </div>
            <div class="cmp-arch-tag-row">
              <span class="cmp-arch-tag cmp-arch-tag-good">Full-text search</span>
              <span class="cmp-arch-tag cmp-arch-tag-good">Inverted index</span>
              <span class="cmp-arch-tag cmp-arch-tag-warn">Agg at scale</span>
            </div>
          </div>

          <!-- Cassandra -->
          <div class="cmp-arch-card" style="border-color:rgba(168,85,247,.2)">
            <div class="cmp-arch-db-hdr"><span style="color:#a855f7;font-weight:800">💍 Cassandra</span><span class="cmp-arch-engine-tag">LSM tree / SSTable</span></div>
            <div class="cmp-arch-desc">Writes go to an in-memory <strong>MemTable</strong> first (instant), then flush to immutable disk <strong>SSTables</strong>. Periodic <strong>compaction</strong> merges SSTables. Reads may check multiple SSTables + Bloom filter. Partition key determines node placement.</div>
            <div class="cmp-arch-diagram">
              <div class="cmp-arch-cass">
                <div class="cmp-arch-cass-row">
                  <div class="cmp-arch-cass-box cmp-arch-cass-mem">MemTable<br><small>in-memory</small></div>
                  <div class="cmp-arch-cass-arrow">→ flush</div>
                  <div style="display:flex;flex-direction:column;gap:4px">
                    ${['SSTable 1', 'SSTable 2', 'SSTable 3'].map((s, i) => `<div class="cmp-arch-cass-box cmp-arch-cass-ss" style="opacity:${1 - i * .2}">${s}</div>`).join('')}
                  </div>
                  <div class="cmp-arch-cass-arrow">→ compact</div>
                  <div class="cmp-arch-cass-box cmp-arch-cass-merged">Merged SSTable</div>
                </div>
                <div style="margin-top:8px;font-size:9px;color:var(--text3)">
                  Partition key hash → consistent hashing ring → target replica nodes
                </div>
                <div class="cmp-arch-cass-bloom">🌸 Bloom filter: skip SSTables that definitely don't have the key</div>
              </div>
              <div class="cmp-arch-note" style="color:#10b981">✅ Millions of writes/sec. ⚠️ Read may touch multiple SSTables + compaction overhead</div>
            </div>
            <div class="cmp-arch-tag-row">
              <span class="cmp-arch-tag cmp-arch-tag-good">Write-optimized</span>
              <span class="cmp-arch-tag cmp-arch-tag-good">Multi-DC native</span>
              <span class="cmp-arch-tag cmp-arch-tag-bad">No ad-hoc queries</span>
            </div>
          </div>

        </div>
      </div>`;

  }

  // ── Init & switch ────────────────────────────────────────────────────────────
  window.cmpSwitch = function (catId) {
    const content = document.getElementById('cmp-content');
    if (!content) return;
    // animate out
    content.classList.remove('cmp-content-anim');
    void content.offsetWidth;
    content.classList.add('cmp-content-anim');
    content.innerHTML = renderTable(catId);
    // update active button
    document.querySelectorAll('.cmp-cat-btn').forEach(b => b.classList.remove('cmp-cat-active'));
    document.querySelectorAll('.cmp-cat-btn').forEach(b => {
      if (b.textContent.trim() === CATEGORIES.find(c => c.id === catId).label) b.classList.add('cmp-cat-active');
    });
  };

  window.initComparePage = function () {
    const root = document.getElementById('compare-root');
    if (!root) return;
    root.innerHTML = renderPage('storage');
  };
})();
