/* ─────────────────────────────────────────────────────────────────────────────
   ClickHouse Explorer — Features
   Progress Dashboard · Query Explainer · Benchmark Showdown · Glossary · Interview Prep
   ───────────────────────────────────────────────────────────────────────────── */

// ══════════════════════════════════════════════════════════════════════════════
// 1. PROGRESS DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function renderProgressDashboard() {
    const el = document.getElementById('progress-dashboard');
    if (!el) return;
    const TM = 8, TC = 12;
    let qp = 0;
    for (let i = 1; i <= TM; i++) {
        try {
            const st = JSON.parse(localStorage.getItem('ch_quiz_' + i) || '{}');
            const qd = window.QUIZ_DATA && window.QUIZ_DATA[i];
            if (!qd) continue;
            const ans = st.answers || {};
            if (Object.keys(ans).length === qd.questions.length &&
                qd.questions.every((q, qi) => ans[qi] === q.correct)) qp++;
        } catch { }
    }
    let cs = 0;
    try { cs = Object.values(JSON.parse(localStorage.getItem('ch_chal_states') || '{}')).filter(s => s?.solved).length; } catch { }

    const ring = (pct, clr) => {
        const r = 26, c = +(2 * Math.PI * r).toFixed(1), off = +(c * (1 - pct / 100)).toFixed(1);
        return `<svg viewBox="0 0 64 64" width="82" height="82" style="display:block;margin:0 auto 8px">
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5.5"/>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="${clr}" stroke-width="5.5"
        stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 32 32)"
        stroke-linecap="round" style="transition:stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)"/>
      <text x="32" y="37" text-anchor="middle" font-size="13" fill="#e2e8f0"
        font-weight="700" font-family="Inter,system-ui">${pct}%</text>
    </svg>`;
    };

    const op = Math.round((qp + cs) / (TM + TC) * 100);
    const next = qp < TM
        ? `📖 Module ${qp + 1} of ${TM} — keep going in the Learning Guide`
        : cs < TC
            ? `⚡ ${TC - cs} SQL Challenge${TC - cs > 1 ? 's' : ''} left — you're on a roll!`
            : '🎉 All done! Try Interview Prep or the Schema Designer.';

    el.innerHTML = `
  <div class="prog-cards-row">
    <div class="prog-card glass">
      ${ring(Math.round(qp / TM * 100), '#6366f1')}
      <div class="prog-card-title">Quiz Modules</div>
      <div class="prog-card-sub">${qp} / ${TM} passed</div>
      <button class="btn" onclick="goToTab('guide')" style="margin-top:10px;width:100%;font-size:11px;padding:5px">Guide →</button>
    </div>
    <div class="prog-card glass">
      ${ring(Math.round(cs / TC * 100), '#10b981')}
      <div class="prog-card-title">SQL Challenges</div>
      <div class="prog-card-sub">${cs} / ${TC} solved</div>
      <button class="btn" onclick="goToTab('challenges')" style="margin-top:10px;width:100%;font-size:11px;padding:5px">Challenges →</button>
    </div>
    <div class="prog-card glass">
      ${ring(op, '#f9c74f')}
      <div class="prog-card-title">Overall Progress</div>
      <div class="prog-card-sub">${qp + cs} / ${TM + TC} complete</div>
      <button class="btn" onclick="goToTab('interview')" style="margin-top:10px;width:100%;font-size:11px;padding:5px">Interview Prep →</button>
    </div>
  </div>
  <div class="prog-next glass">${next}</div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. QUERY EXPLAINER
// ══════════════════════════════════════════════════════════════════════════════
const KNOWN_CH_FUNCS = [
    { re: /\buniqExact\s*\(/i, name: 'uniqExact()', type: 'aggregate', clr: '#ec4899', desc: 'Exact DISTINCT count. Correct but O(n) memory. Use for billing/exact compliance only.', tip: 'Replace with uniq() if ±2% approximation is acceptable — it uses HyperLogLog and is much faster.' },
    { re: /\bcountDistinct\s*\(/i, name: 'countDistinct()', type: 'aggregate', clr: '#ec4899', desc: 'Alias for uniqExact(). Exact but slow on large tables.', tip: 'Replace with uniq() for approx. distinct count using HyperLogLog.' },
    { re: /\buniqMerge\s*\(/i, name: 'uniqMerge()', type: 'aggregate', clr: '#6366f1', desc: 'Reads pre-computed HLL state from AggregatingMergeTree. Extremely fast — merges partial sketches, not raw rows.', tip: null },
    { re: /\buniq\s*\(/i, name: 'uniq()', type: 'aggregate', clr: '#6366f1', desc: '✅ Approximate DISTINCT using HyperLogLog. ~2% error, constant memory, very fast.', tip: null },
    { re: /\bquantiles?\s*\(/i, name: 'quantile(s)()', type: 'aggregate', clr: '#6366f1', desc: 'Approximate percentile via t-digest. Use quantiles() to compute multiple percentiles in one pass.', tip: null },
    { re: /\bcountIf\s*\(/i, name: 'countIf()', type: 'aggregate', clr: '#10b981', desc: '✅ Conditional count in a single scan pass. Avoids subquery overhead.', tip: null },
    { re: /\bsumIf\s*\(/i, name: 'sumIf()', type: 'aggregate', clr: '#10b981', desc: '✅ Conditional sum in a single scan pass. More efficient than CASE WHEN ... THEN col END.', tip: null },
    { re: /\bgroupArray\s*\(/i, name: 'groupArray()', type: 'aggregate', clr: '#f97316', desc: 'Collects values into an in-memory array per group. Can OOM on large groups.', tip: 'Use groupArray(100)(col) to cap array size and avoid memory pressure.' },
    { re: /\btoStartOfHour\s*\(/i, name: 'toStartOfHour()', type: 'datetime', clr: '#14b8a6', desc: '✅ Truncates to hour boundary. Works with sparse index on timestamp columns.', tip: null },
    { re: /\btoStartOfDay\s*\(/i, name: 'toStartOfDay()', type: 'datetime', clr: '#14b8a6', desc: '✅ Truncates to midnight. Standard pattern for daily GROUP BY aggregations.', tip: null },
    { re: /\btoYYYYMM\s*\(/i, name: 'toYYYYMM()', type: 'datetime', clr: '#14b8a6', desc: '✅ Returns YYYYMM integer. Used in PARTITION BY for monthly partitioning — enables partition pruning.', tip: null },
    { re: /\btoHour\s*\(/i, name: 'toHour()', type: 'datetime', clr: '#14b8a6', desc: 'Extracts hour of day (0–23). Useful for hourly traffic patterns.', tip: null },
    { re: /\bnow\s*\(\s*\)/i, name: 'now()', type: 'datetime', clr: '#14b8a6', desc: '✅ Evaluated once per query. Efficient in WHERE: timestamp >= now() - INTERVAL 24 HOUR.', tip: null },
    { re: /\bFINAL\b/i, name: 'FINAL', type: 'ch-special', clr: '#ef4444', desc: 'Forces synchronous dedup on ReplacingMergeTree. Always correct, but scans all rows. Slow on large tables.', tip: 'On large tables: SELECT ... ORDER BY key, version DESC LIMIT 1 BY key can be faster than FINAL.' },
    { re: /\bPREWHERE\b/i, name: 'PREWHERE', type: 'ch-special', clr: '#8b5cf6', desc: '✅ ClickHouse-specific two-phase filter: reads filter column first, then loads remaining columns only for matching rows. Reduces I/O significantly.', tip: null },
    { re: /\bARRAY\s+JOIN\b/i, name: 'ARRAY JOIN', type: 'ch-special', clr: '#8b5cf6', desc: 'Unnests an array column into separate rows — equivalent to UNNEST in PostgreSQL.', tip: null },
    { re: /\bLowCardinality\s*\(/i, name: 'LowCardinality()', type: 'type', clr: '#a3e635', desc: '✅ Dictionary-encodes columns with < ~10k unique values. Makes GROUP BY 3–5× faster.', tip: null },
    { re: /\bNullable\s*\(/i, name: 'Nullable()', type: 'type', clr: '#f97316', desc: 'Stores a null bitmap alongside values. Slows aggregations. Only use when NULL has distinct meaning.', tip: "Replace with a default value ('' or 0) to avoid null bitmap overhead." },
    { re: /SELECT\s+\*/i, name: 'SELECT *', type: 'warning', clr: '#ef4444', desc: '⚠️ Reads ALL columns from disk. Eliminates the key I/O benefit of columnar storage.', tip: 'List only the columns you need: SELECT col_a, col_b FROM ...' },
];

function explainQuery() {
    const sql = (document.getElementById('explainer-input')?.value || '').trim();
    const out = document.getElementById('explainer-output');
    if (!out) return;
    if (!sql) { out.innerHTML = '<div class="expl-empty">Paste a ClickHouse SQL query above and click Analyze →</div>'; return; }

    const found = KNOWN_CH_FUNCS.filter(f => f.re.test(sql));
    const tips = found.filter(f => f.tip);

    // Clause analysis
    const clauses = [];
    const m = (re, label, explain) => { const v = sql.match(re)?.[1]; if (v) clauses.push({ label, val: v.length > 70 ? v.slice(0, 70) + '…' : v, explain }); };
    m(/FROM\s+([\w.`"]+)/i, 'FROM', 'Source table. Only columns listed in SELECT are loaded from disk — ClickHouse column pruning is automatic.');
    m(/WHERE\s+([\s\S]+?)(?:\s+GROUP BY|\s+ORDER BY|\s+HAVING|\s+LIMIT|$)/i, 'WHERE', /timestamp/i.test(sql) ? '✅ Timestamp in WHERE — if timestamp is in ORDER BY, ClickHouse uses the sparse index for range scans.' : 'Ensure the first column in ORDER BY is filtered here for best index performance.');
    m(/GROUP\s+BY\s+([\s\S]+?)(?:\s+HAVING|\s+ORDER BY|\s+LIMIT|$)/i, 'GROUP BY', 'Hash aggregation. LowCardinality columns in GROUP BY keys are dramatically faster.');
    m(/ORDER\s+BY\s+([\s\S]+?)(?:\s+LIMIT|$)/i, 'ORDER BY', 'Final sort. If you only need top-N results, pair with LIMIT — ClickHouse stops early.');
    m(/LIMIT\s+(\d+)/i, 'LIMIT', 'Row limit. ClickHouse uses early termination — queries with LIMIT are significantly faster than without.');

    const typeColors = { aggregate: '#6366f1', datetime: '#14b8a6', 'ch-special': '#8b5cf6', type: '#a3e635', warning: '#ef4444', string: '#f59e0b' };

    out.innerHTML = `
  ${found.length ? `<div class="expl-section-title">Detected Functions & Keywords</div>
  <div class="expl-chips">${found.map(f => `
    <div class="expl-chip" style="border-color:${f.clr}20;background:${f.clr}12">
      <div class="expl-chip-name" style="color:${f.clr}">${f.name} <span class="expl-chip-type">${f.type}</span></div>
      <div class="expl-chip-desc">${f.desc}</div>
    </div>`).join('')}
  </div>` : ''}
  ${clauses.length ? `<div class="expl-section-title">Clause Breakdown</div>
  <div class="expl-clauses">${clauses.map(c => `
    <div class="expl-clause">
      <span class="expl-clause-kw">${c.label}</span>
      <code class="expl-clause-val">${escHtml ? escHtml(c.val) : c.val}</code>
      <div class="expl-clause-note">${c.explain}</div>
    </div>`).join('')}
  </div>` : ''}
  ${tips.length ? `<div class="expl-section-title">💡 Optimization Tips</div>
  <div class="expl-tips">${tips.map(t => `
    <div class="expl-tip"><strong>${t.name}:</strong> ${t.tip}</div>`).join('')}
  </div>` : ''}
  ${!found.length && !clauses.length ? '<div class="expl-empty">No ClickHouse-specific patterns detected. Try a more complex query.</div>' : ''}`;
}

// Sample queries for the explainer
const EXPLAINER_SAMPLES = [
    { label: 'Distinct users (exact)', sql: `SELECT service, uniqExact(user_id) AS exact_dau\nFROM demo.telemetry_events\nWHERE timestamp >= now() - INTERVAL 24 HOUR\nGROUP BY service\nORDER BY exact_dau DESC;` },
    { label: 'Error rate (optimized)', sql: `SELECT service,\n  countIf(level = 'ERROR') AS errors,\n  count() AS total,\n  round(100.0 * countIf(level='ERROR') / count(), 2) AS error_pct\nFROM demo.app_logs\nPREWHERE timestamp >= now() - INTERVAL 24 HOUR\nGROUP BY service\nORDER BY error_pct DESC;` },
    { label: 'SELECT * anti-pattern', sql: `SELECT * FROM demo.app_logs\nWHERE timestamp >= now() - INTERVAL 1 HOUR\nORDER BY timestamp DESC\nLIMIT 100;` },
];

function loadExplainerSample(i) {
    const s = EXPLAINER_SAMPLES[i];
    if (!s) return;
    const el = document.getElementById('explainer-input');
    if (el) { el.value = s.sql; explainQuery(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. BENCHMARK SHOWDOWN
// ══════════════════════════════════════════════════════════════════════════════
const BENCHMARK_PAIRS = [
    {
        title: 'Approximate vs Exact Distinct Count',
        desc: 'HyperLogLog (uniq) vs exact (uniqExact) — same result, very different speed on large tables.',
        a: { label: 'uniqExact — exact', sql: 'SELECT uniqExact(user_id) AS exact_count FROM demo.telemetry_events' },
        b: { label: 'uniq — HyperLogLog ✅', sql: 'SELECT uniq(user_id) AS approx_count FROM demo.telemetry_events' },
        note: 'uniq() uses ~2% relative error but constant memory. Prefer it for dashboards.',
    },
    {
        title: 'Index Column vs Non-Indexed Filter',
        desc: 'Filtering on the ORDER BY prefix (service) vs a non-indexed string column (user_id LIKE).',
        a: { label: 'LIKE on non-indexed column', sql: "SELECT count() FROM demo.telemetry_events WHERE user_id LIKE 'user-1%'" },
        b: { label: 'ORDER BY prefix filter ✅', sql: "SELECT count() FROM demo.telemetry_events WHERE service = 'frontend'" },
        note: "service is first in ORDER BY so ClickHouse uses the sparse index. LIKE on user_id forces a full scan.",
    },
    {
        title: 'SELECT * vs SELECT Specific Columns',
        desc: 'Columnar storage shines when you only read the columns you need.',
        a: { label: 'SELECT * — reads everything', sql: 'SELECT * FROM demo.app_logs ORDER BY timestamp DESC LIMIT 500' },
        b: { label: 'SELECT specific columns ✅', sql: 'SELECT timestamp, level, service FROM demo.app_logs ORDER BY timestamp DESC LIMIT 500' },
        note: 'Each column is a separate file on disk. SELECT * reads all of them; SELECT col reads only 3.',
    },
    {
        title: 'Raw Aggregation vs Materialized View',
        desc: 'Aggregating raw rows vs reading pre-computed partial states from an AggregatingMergeTree.',
        a: { label: 'Raw GROUP BY', sql: 'SELECT service, uniqExact(user_id) AS dau FROM demo.telemetry_events GROUP BY service ORDER BY dau DESC' },
        b: { label: 'Pre-aggregated MV ✅', sql: 'SELECT service, uniqMerge(users_state) AS dau FROM demo.telemetry_hourly_agg GROUP BY service ORDER BY dau DESC' },
        note: 'The MV stores partial HLL states. uniqMerge just combines them — no raw rows scanned.',
    },
    {
        title: 'Per-Row Calculation vs Conditional Aggregate',
        desc: 'CASE WHEN per row vs countIf() in a single vectorized pass.',
        a: { label: 'SUM(CASE WHEN ...)', sql: "SELECT service, sum(CASE WHEN level='ERROR' THEN 1 ELSE 0 END) AS errors FROM demo.app_logs GROUP BY service" },
        b: { label: "countIf() ✅", sql: "SELECT service, countIf(level='ERROR') AS errors FROM demo.app_logs GROUP BY service" },
        note: 'countIf() is vectorized and avoids per-row branching. Preferred ClickHouse idiom.',
    },
];

let benchRunning = false;

async function runBenchmark(idx) {
    if (benchRunning) return;
    const pair = BENCHMARK_PAIRS[idx];
    if (!pair) return;
    const card = document.getElementById(`bench-card-${idx}`);
    if (!card) return;

    benchRunning = true;
    const btn = card.querySelector('.bench-run-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }

    const resEl = card.querySelector('.bench-result');
    resEl.style.display = 'block';
    resEl.innerHTML = '<em style="color:var(--text3)">Querying ClickHouse…</em>';

    const run = async (sql) => {
        const t0 = performance.now();
        try {
            const r = await fetch(`${window.API || 'http://localhost:3001/api'}/query`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql }),
            });
            const d = await r.json();
            const ms = +(performance.now() - t0).toFixed(1);
            return { ms, ok: !d.error, result: d.error || (Array.isArray(d.rows) ? JSON.stringify(d.rows[0]) : JSON.stringify(d[0])) };
        } catch {
            return { ms: 0, ok: false, result: 'Backend offline' };
        }
    };

    const [ra, rb] = await Promise.all([run(pair.a.sql), run(pair.b.sql)]);
    const maxMs = Math.max(ra.ms, rb.ms) || 1;
    const winner = ra.ms <= rb.ms ? 'a' : 'b';

    resEl.innerHTML = `
  <div class="bench-timing-row">
    <div class="bench-timing ${winner === 'a' ? 'bench-winner' : ''}">
      <div class="bench-timing-label">${pair.a.label}</div>
      <div class="bench-timing-ms">${ra.ms} ms</div>
      <div class="bench-bar-wrap"><div class="bench-bar" style="width:${(ra.ms / maxMs * 100).toFixed(0)}%;background:${winner === 'a' ? '#10b981' : '#ef4444'}"></div></div>
      ${ra.ok ? `<div class="bench-val">${ra.result?.slice(0, 80) || ''}</div>` : `<div style="color:var(--red);font-size:11px">${ra.result}</div>`}
    </div>
    <div class="bench-timing ${winner === 'b' ? 'bench-winner' : ''}">
      <div class="bench-timing-label">${pair.b.label}</div>
      <div class="bench-timing-ms">${rb.ms} ms</div>
      <div class="bench-bar-wrap"><div class="bench-bar" style="width:${(rb.ms / maxMs * 100).toFixed(0)}%;background:${winner === 'b' ? '#10b981' : '#ef4444'}"></div></div>
      ${rb.ok ? `<div class="bench-val">${rb.result?.slice(0, 80) || ''}</div>` : `<div style="color:var(--red);font-size:11px">${rb.result}</div>`}
    </div>
  </div>
  <div class="bench-note">💡 ${pair.note}</div>`;

    benchRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '▶ Run Both'; }
}

function initBenchmark() {
    const el = document.getElementById('benchmark-list');
    if (!el || el.dataset.init) return;
    el.dataset.init = '1';
    el.innerHTML = BENCHMARK_PAIRS.map((p, i) => `
  <div class="bench-card glass" id="bench-card-${i}">
    <div class="bench-card-header">
      <div>
        <div class="bench-card-title">${String(i + 1).padStart(2, '0')} ${p.title}</div>
        <div class="bench-card-desc">${p.desc}</div>
      </div>
      <button class="btn bench-run-btn" onclick="runBenchmark(${i})">▶ Run Both</button>
    </div>
    <div class="bench-queries">
      <div class="bench-query"><span class="bench-qlabel bench-qlabel-a">A</span><code>${p.a.label}</code></div>
      <div class="bench-query"><span class="bench-qlabel bench-qlabel-b">B ✅</span><code>${p.b.label}</code></div>
    </div>
    <div class="bench-result" style="display:none"></div>
  </div>`).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. GLOSSARY
// ══════════════════════════════════════════════════════════════════════════════
const GLOSSARY_ITEMS = [
    // Data Types
    { term: 'UInt8 / UInt64', cat: 'Data Types', desc: 'Unsigned integers from 1–8 bytes. Always prefer the smallest type that fits your range — smaller types compress better and fit more values per cache line.' },
    { term: 'String', cat: 'Data Types', desc: 'Variable-length bytes. No max limit. Stored as length-prefixed byte arrays. For low-cardinality string columns (< ~10k unique), always wrap in LowCardinality().' },
    { term: 'LowCardinality(T)', cat: 'Data Types', desc: 'Dictionary-encodes any type. Stores integer IDs internally. Makes GROUP BY and filters 3–5× faster for columns with < ~10k unique values. Essentially free to add.' },
    { term: 'Nullable(T)', cat: 'Data Types', desc: 'Adds a null bitmap alongside values. Slows aggregations. Avoid unless NULL has semantics distinct from 0 or empty string.' },
    { term: 'DateTime', cat: 'Data Types', desc: '4-byte Unix timestamp (second precision). The most efficient time column for ClickHouse partitioning and range scans.' },
    { term: 'DateTime64(n)', cat: 'Data Types', desc: 'DateTime with sub-second precision (n = 0–9). Uses 8 bytes. Use for distributed tracing where millisecond/nanosecond precision matters.' },
    { term: 'Date', cat: 'Data Types', desc: '2-byte day-precision date (no time). Use for date-only partitioning keys or low-precision aggregations.' },
    { term: 'Float32 / Float64', cat: 'Data Types', desc: 'IEEE 754 floats. Avoid for monetary values (precision loss). Use Decimal(precision, scale) for currency.' },
    { term: 'Decimal(P, S)', cat: 'Data Types', desc: 'Fixed-point decimal with P total digits and S decimal places. Use for cost_usd, budget, billing — never Float for money.' },
    { term: 'Array(T)', cat: 'Data Types', desc: 'Variable-length array stored compactly per row. Use ARRAY JOIN or arrayMap/arrayFilter for processing. groupArray() creates these dynamically.' },
    { term: 'AggregateFunction(f, T)', cat: 'Data Types', desc: 'Stores a partial aggregation state (e.g. HLL sketch for uniq, t-digest for quantile). Used in AggregatingMergeTree + Materialized Views for incremental pre-aggregation.' },
    // Engines
    { term: 'MergeTree', cat: 'Engines', desc: 'Foundation of all ClickHouse engines. Data is written in immutable Parts, then merged in the background. Supports ORDER BY (sparse index), PARTITION BY, TTL, and skip indexes.' },
    { term: 'ReplacingMergeTree(ver)', cat: 'Engines', desc: 'Deduplicates rows with the same ORDER BY key, keeping the highest version. Dedup is async (at merge time). Use FINAL or query-time dedup patterns for consistent reads.' },
    { term: 'SummingMergeTree(cols)', cat: 'Engines', desc: 'Collapses same-key rows by summing specified numeric columns during merges. Always use SUM() in queries — pre-summing is not guaranteed until merge occurs.' },
    { term: 'AggregatingMergeTree', cat: 'Engines', desc: 'Stores partial aggregate states (AggregateFunction columns) and merges them on background merge. Paired with Materialized Views for fast incremental rollups.' },
    { term: 'CollapsingMergeTree(sign)', cat: 'Engines', desc: 'Uses a sign column (+1/-1) to cancel previous rows during merge. Insert sign=-1 to cancel, then sign=+1 for the new value. Used for corrections/amendments in billing systems.' },
    { term: 'ReplicatedMergeTree', cat: 'Engines', desc: 'Any *MergeTree engine prefixed with Replicated. Coordinates INSERT replication via ClickHouse Keeper (ZooKeeper-compatible). Scale to 1–3 replicas per shard for HA.' },
    { term: 'Distributed', cat: 'Engines', desc: 'A virtual table that fans out queries to shards via a cluster definition. Uses a sharding key (hash function) to route INSERTs. SELECT merges results from all shards.' },
    // Concepts
    { term: 'Part', cat: 'Concepts', desc: 'Immutable on-disk directory created per INSERT batch. Contains columnar data files, index.bin, and mark files. Background merges combine small parts into larger ones.' },
    { term: 'Granule', cat: 'Concepts', desc: 'The smallest unit of data ClickHouse reads from disk (default 8192 rows). The sparse primary index points to granule offsets — index_granularity controls this size.' },
    { term: 'Sparse Primary Index', cat: 'Concepts', desc: 'ClickHouse stores one index entry per granule (not per row). Much smaller than a B-tree index, fits in RAM. Used to skip granules that can\'t contain matching rows.' },
    { term: 'Skip Index', cat: 'Concepts', desc: 'Secondary index stored per granule (e.g. minmax, set, bloom_filter, tokenbf_v1). Allows skipping granules that provably don\'t match a WHERE condition.' },
    { term: 'Materialized View (MV)', cat: 'Concepts', desc: 'A trigger-based INSERT hook. When new rows arrive in the source table, the MV SELECT runs over the new batch and inserts results into a target table. Does NOT backfill existing data.' },
    { term: 'TTL', cat: 'Concepts', desc: 'Time To Live — defines when rows or partitions expire. Can move data to cheaper storage tiers or DELETE it. Evaluated at merge time, not on insertion.' },
    { term: 'Partition', cat: 'Concepts', desc: 'A logical group of parts sharing the same PARTITION BY key value. ClickHouse prunes entire partitions when query filters match. Monthly partitioning (toYYYYMM) is a common pattern.' },
    { term: 'Shard', cat: 'Concepts', desc: 'A subset of the total data, stored on a distinct set of nodes. A Distributed table fans writes to shards based on a sharding key hash. Reads are merged from all shards.' },
    { term: 'Replica', cat: 'Concepts', desc: 'A copy of a shard for high availability. Writes to one replica are automatically synced to others via ClickHouse Keeper. Reads can be served from any replica.' },
    { term: 'ClickHouse Keeper', cat: 'Concepts', desc: 'ZooKeeper-compatible coordination service built into ClickHouse. Manages replication logs, leader election, and DDL locks. Replaces the need for a separate ZooKeeper cluster.' },
    { term: 'Mutation', cat: 'Concepts', desc: 'An ALTER TABLE UPDATE/DELETE operation in ClickHouse. Rewrites entire data parts — expensive. Prefer TTL for deletes and ReplacingMergeTree for upserts instead.' },
    { term: 'FINAL', cat: 'Concepts', desc: 'Query modifier for ReplacingMergeTree/CollapsingMergeTree. Forces synchronous deduplication before returning results. Correct but slow on large tables.' },
    { term: 'PREWHERE', cat: 'Concepts', desc: 'ClickHouse-specific two-phase filter. Reads only the filter column first, then loads other columns only for matching granules. Automated by ClickHouse in many cases.' },
    // Functions
    { term: 'uniq(col)', cat: 'Functions', desc: 'Approximate DISTINCT using HyperLogLog. ~2% error, O(1) memory. Ideal for distinct user counts, cardinality estimation.' },
    { term: 'quantile(p)(col)', cat: 'Functions', desc: 'Approximate p-th percentile using t-digest. p=0.95 for P95 latency. Use quantiles(0.5, 0.95, 0.99)(col) to compute multiple percentiles in one pass.' },
    { term: 'countIf(cond)', cat: 'Functions', desc: 'Counts rows where condition is true. Single-pass vectorized. Prefer over SUM(CASE WHEN) for conditional counting.' },
    { term: 'toStartOfHour(dt)', cat: 'Functions', desc: 'Truncates DateTime to hour. Compatible with ORDER BY timestamp index for efficient range scans.' },
    { term: 'groupArray(N)(col)', cat: 'Functions', desc: 'Collects up to N values per group into an array. Cap N to avoid OOM on large groups.' },
    { term: 'arrayMap(f, arr)', cat: 'Functions', desc: 'Applies a lambda to each element of an array. Equivalent to Python list comprehension — no loop syntax needed.' },
    { term: 'dictGet(dict, attr, key)', cat: 'Functions', desc: 'Looks up an attribute from a Dictionary (external key-value store loaded into RAM). O(1) join-free lookup — much faster than JOIN for small reference tables.' },
    { term: 'runningDifference(col)', cat: 'Functions', desc: 'Computes the difference between consecutive rows. Useful for delta metrics (bytes_transferred_delta, etc). ORDER BY matters for correctness.' },
    { term: 'formatReadableSize(bytes)', cat: 'Functions', desc: "Formats bytes as human-readable string: '1.50 GiB'. Common in system.* table queries." },
    // SQL Patterns
    { term: 'LIMIT N BY key', cat: 'SQL Patterns', desc: 'Top-N per group in a single pass. Equivalent to RANK() PARTITION BY ... WHERE rank<=N, but more efficient. Example: top 3 errors per service.' },
    { term: 'ORDER BY key, version DESC LIMIT 1 BY key', cat: 'SQL Patterns', desc: 'Manual deduplication pattern. Faster than FINAL on large ReplacingMergeTree tables. Select the latest version per key without a full-table sync.' },
    { term: 'WITH TOTALS', cat: 'SQL Patterns', desc: 'Appends a grand total row to GROUP BY results. Useful for dashboards that show subtotals + overall total in a single query.' },
    { term: 'SAMPLE n', cat: 'SQL Patterns', desc: 'Reads a deterministic fraction of rows (e.g. SAMPLE 0.1 = 10%). Requires a SAMPLE BY key in the table definition. Great for approximate queries on huge tables.' },
    { term: 'INSERT SELECT', cat: 'SQL Patterns', desc: 'Inserts results of a SELECT query directly into a table. More efficient than fetching to client and re-inserting — no data leaves the server.' },
];

let glossaryFilter = { search: '', cat: 'all' };

function loadGlossary() {
    renderGlossary();
}

function filterGlossary() {
    glossaryFilter.search = (document.getElementById('gloss-search')?.value || '').toLowerCase();
    glossaryFilter.cat = document.getElementById('gloss-cat')?.value || 'all';
    renderGlossary();
}

function renderGlossary() {
    const el = document.getElementById('glossary-list');
    if (!el) return;
    const { search, cat } = glossaryFilter;
    const items = GLOSSARY_ITEMS.filter(g =>
        (cat === 'all' || g.cat === cat) &&
        (!search || g.term.toLowerCase().includes(search) || g.desc.toLowerCase().includes(search))
    );
    document.getElementById('gloss-count').textContent = `${items.length} terms`;
    el.innerHTML = items.length
        ? items.map(g => `
    <div class="gloss-card glass">
      <div class="gloss-term">${g.term}</div>
      <span class="gloss-cat">${g.cat}</span>
      <div class="gloss-desc">${g.desc}</div>
    </div>`).join('')
        : '<div style="color:var(--text3);grid-column:1/-1;padding:20px">No terms match your search.</div>';
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. INTERVIEW PREP
// ══════════════════════════════════════════════════════════════════════════════
const INTERVIEW_QA = [
    { cat: 'Fundamentals', q: 'What is the difference between OLAP and OLTP? Which is ClickHouse?', a: 'OLTP (Online Transaction Processing) handles frequent, small reads/writes on individual rows — think banking, order management, user profiles. OLAP (Online Analytical Processing) handles infrequent but complex queries that scan millions or billions of rows across many columns. ClickHouse is a pure OLAP engine: it\'s optimised for aggregate queries over large datasets, not for point lookups or heavy concurrent writes per row.' },
    { cat: 'Fundamentals', q: 'Explain columnar storage. Why is it faster for analytics than row storage?', a: 'In row storage (PostgreSQL, MySQL), all columns of a row are stored contiguously on disk. Reading 3 columns from 10M rows means reading all 10M full rows. In columnar storage (ClickHouse, Parquet), each column is its own file. Reading 3 columns reads only those 3 files — I/O is proportional to columns accessed, not total row width. Additionally, a single column contains similar values, making compression ratios 10–100× better than row stores.' },
    { cat: 'Fundamentals', q: 'What is a "data part" in ClickHouse and how does merge work?', a: 'Every INSERT batch creates an immutable on-disk directory called a Part. Each part contains columnar files (col.bin), mark files (col.mrk3 — used as index pointers), and primary.idx. Parts are small at first. In the background, ClickHouse continuously merges smaller parts into larger ones — this is where SummingMergeTree summing, ReplacingMergeTree deduplication, and TTL expiry actually happen. The "Too many parts" error means inserts are creating parts faster than merges can consolidate them.' },
    { cat: 'Fundamentals', q: 'What is a granule and how does the sparse primary index use it?', a: 'A granule is the smallest unit ClickHouse reads from disk — by default 8,192 rows. The sparse primary index stores one index entry per granule (not per row), so the entire index fits in RAM even for billion-row tables. When a query has a WHERE on the ORDER BY column, ClickHouse binary-searches the sparse index to find which granules might contain matching rows, then reads only those granules from disk. Non-matching granules are skipped entirely.' },
    { cat: 'Engines', q: 'When would you use ReplacingMergeTree vs MergeTree? What is the role of FINAL?', a: 'Use ReplacingMergeTree when your data has logical duplicates — for example, a cloud billing export that re-delivers the same line items, or an event stream with at-least-once delivery. You declare a version column (e.g. unix timestamp); during merge, ClickHouse keeps the row with the highest version per ORDER BY key. The catch: deduplication happens at merge time, not immediately. Between merges, duplicates coexist. FINAL forces synchronous dedup before returning results — always correct, but slower because it scans all rows.' },
    { cat: 'Engines', q: 'Explain SummingMergeTree. Why must you still use SUM() in queries?', a: 'SummingMergeTree automatically sums specified numeric columns for rows that share the same ORDER BY key during background merges. But because merges don\'t happen instantly, a table may contain multiple unmerged parts with separate rows for the same key. If you query without SUM(), you\'ll get multiple rows and incorrect totals. Always query with SUM() — this is correct whether or not the merge has happened yet.' },
    { cat: 'Engines', q: 'What is AggregatingMergeTree and how does it differ from SummingMergeTree?', a: 'SummingMergeTree can only sum numeric values. AggregatingMergeTree stores arbitrary partial aggregation states using the AggregateFunction(f, T) type — for example, HyperLogLog sketches (for uniq), t-digest (for quantile), or count state. It\'s always used with a Materialized View: the MV writes *State() functions (uniqState, countState), and queries use *Merge() functions (uniqMerge, countMerge) to finalize them. This enables incrementally maintained rollups with complex aggregations.' },
    { cat: 'Engines', q: 'Explain CollapsingMergeTree with a real-world example.', a: 'CollapsingMergeTree uses a sign column (Int8, +1 or -1) to cancel previous rows. Example: a budget table. Initial budget: INSERT (team=\'infra\', budget=5000, sign=+1). Later you need to correct it: INSERT (team=\'infra\', budget=5000, sign=-1) then (team=\'infra\', budget=7500, sign=+1). During merge, the +1 and -1 rows with the same ORDER BY key cancel each other out, leaving only the corrected $7,500 row. Use case: billing corrections, inventory adjustments, ledger entries where you can\'t update in place.' },
    { cat: 'Performance', q: 'What is the ORDER BY\'s role in MergeTree performance? How do you pick column order?', a: 'The ORDER BY in MergeTree defines two things: (1) the sort order within each data part (determines which rows are adjacent on disk), and (2) the sparse primary index entries (one per granule). Queries filtering on the first ORDER BY column(s) can use the sparse index to skip granules. Column order rule: put your most frequently filtered, lowest-cardinality columns first. Common pattern: ORDER BY (tenant_id, service, timestamp) — cardinality escalates left to right. High-cardinality columns (user_id, UUID) should never be first if you have other filter columns.' },
    { cat: 'Performance', q: 'What is a Materialized View in ClickHouse? How does it differ from Postgres?', a: 'In PostgreSQL, a Materialized View is a snapshot refreshed manually. In ClickHouse, a MV is a live INSERT trigger: whenever new rows land in the source table, the MV query runs over just those new rows and inserts results into the target table. It\'s always up to date and never needs a full refresh. Key gotcha: the MV only processes rows inserted AFTER creation — it does NOT backfill historical data. For backfill, you INSERT SELECT from source to target manually after creating the MV.' },
    { cat: 'Performance', q: 'Explain LowCardinality(String). When should you use it?', a: 'LowCardinality wraps any type in dictionary encoding: ClickHouse maintains a dictionary of unique values and stores integer IDs in the actual column. This makes GROUP BY, WHERE equality, and JOIN operations work on integers (fast) rather than string comparisons (slow). Use it for any String column with fewer than ~10,000 unique values: service names, log levels, countries, event types, team names, status codes. It\'s essentially free — add it whenever in doubt for low-cardinality strings.' },
    { cat: 'Performance', q: 'What is PREWHERE and how is it different from WHERE?', a: 'WHERE loads all columns specified in SELECT, then filters. PREWHERE is a ClickHouse-specific two-phase optimization: it reads only the PREWHERE column(s) from disk first, identifies which granules pass the filter, then loads remaining columns only for those granules. This saves I/O when the filter is highly selective (eliminates most rows). ClickHouse auto-promotes many WHERE conditions to PREWHERE. You can write it explicitly for clarity or when the optimizer doesn\'t pick it automatically. Never use PREWHERE on calculated expressions — only on raw columns.' },
    { cat: 'Architecture', q: 'Explain the difference between sharding and replication in a ClickHouse cluster.', a: 'Sharding = horizontal Scale Out. Each shard holds a distinct portion of the data (e.g. shard 1 holds users with murmurHash3_32(user_id) % 2 = 0). More shards = more total storage and parallelism. Replication = High Availability. Each replica holds an identical copy of its shard\'s data. If one replica fails, reads/writes continue on surviving replicas. A production cluster typically combines both: 2 shards × 2 replicas = 4 nodes total. The Distributed table engine abstracts both: it fans INSERTs out by shard key and merges SELECTs from all shards.' },
    { cat: 'Architecture', q: 'What is ClickHouse Keeper? Why does ClickHouse need it for replication?', a: 'ClickHouse Keeper is a ZooKeeper-compatible coordination service built into ClickHouse itself. Replication requires a distributed log: when node1 inserts data, it writes a log entry to Keeper. Node2 reads that log and fetches the data from node1. Keeper also handles: leader election for which replica handles certain mutations, DDL replication locks (ON CLUSTER commands), and metadata for replicated tables. You can run Keeper as a separate sidecar process or embedded in ClickHouse nodes. No more external ZooKeeper cluster needed.' },
    { cat: 'Architecture', q: 'How does a Distributed table route INSERT and SELECT operations?', a: 'INSERT: The Distributed table hashes the sharding key (e.g. murmurHash3_32(user_id)) and sends each row to the appropriate shard. Rows with the same user_id always go to the same shard — this ensures aggregations on user_id are local to one shard. SELECT: The Distributed table sends the query to all shards in parallel, receives partial results, and merges them (applying final ORDER BY, LIMIT, etc.) before returning to the client. For GROUP BY, each shard groups locally; the coordinator does a final re-aggregation.' },
    { cat: 'Architecture', q: 'What is the key gotcha with Materialized Views and existing data?', a: 'Materialized Views in ClickHouse are INSERT triggers — they only fire for NEW data inserted after the MV is created. If your source table already has 100M rows when you create the MV, the MV target table starts empty and only processes rows inserted going forward. To populate the MV with historical data, you must run: INSERT INTO mv_target SELECT ... FROM source_table. This can be done in batches. Always create the MV first (so no new data is missed), then backfill historical data.' },
    { cat: 'Production', q: 'Your table gets "Too many parts" errors. What caused this and how do you fix it?', a: 'ClickHouse limits the number of active parts per partition (default 300). When each INSERT creates a new part (small batches or very frequent inserts), parts accumulate faster than the background merge thread can consolidate them. ClickHouse starts throwing "Too many parts" to slow ingestion. Fix: (1) Batch your INSERTs — aim for 100k–1M rows per insert, not one row at a time. (2) Increase max_insert_block_size or batch on the client side. (3) Use an async insert queue (async_insert=1). (4) If using Kafka, increase batch.size on the Kafka consumer.' },
    { cat: 'Production', q: 'You need to auto-delete data older than 90 days. How do you implement this without an external cron job?', a: 'Use TTL at the table or column level: ALTER TABLE events MODIFY TTL timestamp + INTERVAL 90 DAY. ClickHouse evaluates TTL during background merges and drops expired rows or entire expired partitions. For partition-level TTL (more efficient): TTL toStartOfMonth(timestamp) + INTERVAL 3 MONTH — entire partition directories are deleted at once rather than row-by-row. You can also use TTL to MOVE data to a slower storage tier instead of deleting: TTL timestamp + INTERVAL 30 DAY TO DISK \'s3\'.' },
    { cat: 'Production', q: 'You\'re migrating from Elasticsearch to ClickHouse for log storage. Key differences?', a: '(1) Schema: Elasticsearch is schemaless; ClickHouse requires a schema. Design your columns upfront. (2) Full-text search: ES has inverted indexes everywhere; ClickHouse requires explicit tokenbf_v1 or ngrambf_v1 skip indexes for text search — and they\'re much more limited. (3) Write path: ES ingests one document at a time efficiently; ClickHouse needs batched inserts (100k+ rows). (4) Cardinality: ES handles high-cardinality GROUP BY poorly; ClickHouse excels at it. (5) Storage: ClickHouse typically uses 5–20× less disk space due to better compression. Great trade-off for log analytics, poor trade-off for full-text document search.' },
    { cat: 'Production', q: 'Your ORDER BY has user_id first on a table with 10M unique users. How does this hurt performance?', a: 'High-cardinality columns as the first ORDER BY key destroy index effectiveness. With 10M unique user_ids, the sparse index has one entry per 8,192 rows. A query for WHERE service = \'frontend\' needs to scan EVERY granule because user_id values are random — the service column is not sorted. Fix: Reorder to ORDER BY (service, timestamp, user_id). Now queries filtering on service skip most granules. user_id moves to the last position where it provides minimal index benefit but also causes no harm. Recreate the table with the new ORDER BY and reload data.' },
];

let answerVisibility = {};

function loadInterviewPrep() {
    const el = document.getElementById('interview-list');
    if (!el || el.dataset.init) return;
    el.dataset.init = '1';
    answerVisibility = {};
    const cats = [...new Set(INTERVIEW_QA.map(q => q.cat))];
    el.innerHTML = cats.map(cat => {
        const qs = INTERVIEW_QA.filter(q => q.cat === cat);
        const globalIdx = qs.map(q => INTERVIEW_QA.indexOf(q));
        return `
    <div class="iqa-section">
      <div class="iqa-cat">${cat}</div>
      ${qs.map((q, li) => {
            const gi = INTERVIEW_QA.indexOf(q);
            return `
        <div class="iqa-item" id="iqa-item-${gi}">
          <button class="iqa-q" onclick="toggleAnswer(${gi})">
            <span class="iqa-qnum">${String(gi + 1).padStart(2, '0')}</span>
            <span class="iqa-qtext">${q.q}</span>
            <span class="iqa-chevron" id="iqa-chev-${gi}">›</span>
          </button>
          <div class="iqa-a" id="iqa-a-${gi}" style="display:none">${q.a}</div>
        </div>`;
        }).join('')}
    </div>`;
    }).join('');
}

function toggleAnswer(i) {
    const aEl = document.getElementById(`iqa-a-${i}`);
    const chev = document.getElementById(`iqa-chev-${i}`);
    const item = document.getElementById(`iqa-item-${i}`);
    if (!aEl) return;
    const open = aEl.style.display !== 'none';
    aEl.style.display = open ? 'none' : 'block';
    if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
    if (item) item.classList.toggle('iqa-open', !open);
}
