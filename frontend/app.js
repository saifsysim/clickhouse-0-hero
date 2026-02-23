/* ─────────────────────────────────────────────────────────────────────────────
   ClickHouse Explorer – Application JavaScript
   ───────────────────────────────────────────────────────────────────────────── */

const API = 'http://localhost:3001/api';
let telemetryCharts = {};
let logCharts = {};
let costCharts = {};
let lastQueryResults = [];

// ─── Navigation ──────────────────────────────────────────────────────────────
function switchTab(tab, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (btn) btn.classList.add('active');
    if (tab === 'telemetry') loadTelemetry();
    if (tab === 'logging') { loadLogSummary(); loadLogs(); }
    if (tab === 'costs') loadCosts();
    if (tab === 'cluster') loadCluster();
    if (tab === 'query') loadPlaygroundTables();
    if (tab === 'ai') checkAIStatus();
}

// ─── Health Check ─────────────────────────────────────────────────────────────
async function checkHealth() {
    const dot = document.getElementById('connectionBadge').querySelector('.badge-dot');
    const text = document.getElementById('connectionText');
    try {
        const r = await fetch(`${API}/health`);
        if (r.ok) {
            dot.className = 'badge-dot connected';
            text.textContent = 'Connected';
        } else { throw new Error(); }
    } catch {
        dot.className = 'badge-dot error';
        text.textContent = 'Disconnected';
    }
}

// ─── Chart helpers ────────────────────────────────────────────────────────────
const CH_COLORS = [
    '#f9c74f', '#6366f1', '#10b981', '#f97316', '#ec4899',
    '#14b8a6', '#8b5cf6', '#22d3ee', '#a3e635', '#fb923c',
];

function buildChart(id, type, labels, datasets, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    const key = id;
    if (telemetryCharts[key]) telemetryCharts[key].destroy();
    if (logCharts[key]) logCharts[key].destroy();
    if (costCharts[key]) costCharts[key].destroy();

    const chart = new Chart(el.getContext('2d'), {
        type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 600, easing: 'easeOutQuart' },
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, boxWidth: 12 } },
                tooltip: {
                    backgroundColor: '#131621',
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderWidth: 1,
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    padding: 10,
                },
                ...opts.plugins,
            },
            scales: type === 'bar' || type === 'line' ? {
                x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
                ...opts.scales,
            } : undefined,
            ...opts.extra,
        },
    });
    telemetryCharts[id] = chart;
    return chart;
}

// ─── Formatter helpers ────────────────────────────────────────────────────────
const fmt = {
    num: v => Intl.NumberFormat('en', { notation: 'compact' }).format(Number(v)),
    usd: v => '$' + Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ms: v => Number(v).toFixed(0) + ' ms',
};

// ════════════════════════════════════════════════════════════════════════════════
// TELEMETRY
// ════════════════════════════════════════════════════════════════════════════════
async function loadTelemetry() {
    try {
        const r = await fetch(`${API}/telemetry/stats?hours=24`);
        const data = await r.json();

        // KPIs (from funnel summary)
        const totalEvents = data.funnel.reduce((a, b) => a + Number(b.cnt), 0);
        const totalUsers = Math.max(...data.funnel.map(f => Number(f.unique_users)));
        const totalSvcs = data.topServices.length;
        document.getElementById('kpi-total-events').textContent = fmt.num(totalEvents);
        document.getElementById('kpi-unique-users').textContent = fmt.num(totalUsers);
        document.getElementById('kpi-services').textContent = totalSvcs;
        document.getElementById('kpi-p95').textContent = '—'; // coming from MV

        // Events timeline chart
        const hours = [...new Set(data.timeline.map(d => d.hour))].sort();
        const types = [...new Set(data.timeline.map(d => d.event_type))];
        const datasets = types.map((type, i) => ({
            label: type,
            data: hours.map(h => {
                const row = data.timeline.find(d => d.hour === h && d.event_type === type);
                return row ? Number(row.cnt) : 0;
            }),
            backgroundColor: CH_COLORS[i % CH_COLORS.length] + '66',
            borderColor: CH_COLORS[i % CH_COLORS.length],
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
        }));
        buildChart('telemetryTimelineChart', 'line',
            hours.map(h => h.slice(11, 16)),
            datasets
        );

        // Funnel (donut)
        buildChart('telemetryFunnelChart', 'doughnut',
            data.funnel.map(d => d.event_type),
            [{
                data: data.funnel.map(d => d.cnt),
                backgroundColor: CH_COLORS,
                borderWidth: 2,
                borderColor: '#0d0f17',
            }],
            { plugins: { legend: { position: 'right' } }, extra: { cutout: '65%', radius: '90%' } }
        );

        // Services bar
        buildChart('servicesChart', 'bar',
            data.topServices.map(s => s.service),
            [
                { label: 'Total Events', data: data.topServices.map(s => s.total_events), backgroundColor: '#f9c74f66', borderColor: '#f9c74f', borderWidth: 2 },
                { label: 'Unique Users', data: data.topServices.map(s => s.unique_users), backgroundColor: '#6366f166', borderColor: '#6366f1', borderWidth: 2 },
            ]
        );
    } catch (e) {
        console.error('Telemetry load error:', e);
    }
}

async function injectEvent() {
    const btn = document.querySelector('#tab-telemetry .btn-primary');
    btn.textContent = '⏳ Inserting…';
    btn.disabled = true;
    try {
        const r = await fetch(`${API}/telemetry/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service: document.getElementById('inject-service').value,
                event_type: document.getElementById('inject-event').value,
                user_id: document.getElementById('inject-user').value,
                properties: { manual: true, ts: Date.now() },
            }),
        });
        const d = await r.json();
        const el = document.getElementById('inject-result');
        if (d.ok) {
            el.textContent = `✅ Event inserted at ${new Date().toISOString()} – refresh charts to see it.`;
            el.style.color = 'var(--green)';
            setTimeout(loadTelemetry, 200);
        } else {
            el.textContent = `❌ ${d.error}`;
            el.style.color = 'var(--red)';
        }
    } finally {
        btn.textContent = '⚡ INSERT INTO ClickHouse';
        btn.disabled = false;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// LOGGING
// ════════════════════════════════════════════════════════════════════════════════
async function loadLogSummary() {
    try {
        const r = await fetch(`${API}/logs/summary`);
        const data = await r.json();

        const lc = {};
        data.levelCounts.forEach(d => { lc[d.level] = d.cnt; });
        document.getElementById('log-debug').textContent = fmt.num(lc.DEBUG || 0);
        document.getElementById('log-info').textContent = fmt.num(lc.INFO || 0);
        document.getElementById('log-warn').textContent = fmt.num(lc.WARN || 0);
        document.getElementById('log-error').textContent = fmt.num(lc.ERROR || 0);

        // Error rate chart
        const hours = data.errorRate.map(d => d.hour.slice(11, 16));
        buildChart('logErrorRateChart', 'bar',
            hours,
            [
                { label: 'Errors', data: data.errorRate.map(d => d.errors), backgroundColor: '#ef444466', borderColor: '#ef4444', borderWidth: 2 },
                { label: 'Warnings', data: data.errorRate.map(d => d.warnings), backgroundColor: '#f59e0b66', borderColor: '#f59e0b', borderWidth: 2 },
            ]
        );

        // Top errors list
        const list = document.getElementById('topErrorsList');
        list.innerHTML = data.topErrors.slice(0, 8).map(e => `
      <div class="top-error-item">
        <span class="error-msg">${e.message} <em style="color:var(--text3)">(${e.service})</em></span>
        <span class="error-count">${fmt.num(e.occurrences)}</span>
      </div>
    `).join('');
    } catch (e) {
        console.error('Log summary error:', e);
    }
}

let logDebounce;
function debounceLoadLogs() {
    clearTimeout(logDebounce);
    logDebounce = setTimeout(loadLogs, 350);
}

async function loadLogs() {
    const level = document.getElementById('log-level-filter').value;
    const service = document.getElementById('log-service-filter').value;
    const search = document.getElementById('log-search').value;
    const tbody = document.getElementById('logTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading-row">⏳ Querying ClickHouse…</td></tr>';

    try {
        const qs = new URLSearchParams({ level, service, search, limit: 200 });
        const r = await fetch(`${API}/logs?${qs}`);
        const rows = await r.json();

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading-row">No logs match your filters.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(row => `
      <tr>
        <td style="white-space:nowrap;font-family:var(--mono);font-size:11px">${row.timestamp}</td>
        <td><span class="level-badge level-${row.level}">${row.level}</span></td>
        <td style="color:var(--accent2)">${row.service}</td>
        <td style="font-family:var(--mono);font-size:11px">${row.host}</td>
        <td style="font-family:var(--mono);font-size:11px">${row.duration_ms}ms</td>
        <td>${escHtml(row.message)}</td>
      </tr>
    `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-row" style="color:var(--red)">Error: ${e.message}</td></tr>`;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// COSTS
// ════════════════════════════════════════════════════════════════════════════════
async function loadCosts() {
    try {
        const r = await fetch(`${API}/costs?days=30`);
        const data = await r.json();

        // KPIs
        const totalCost = data.byService.reduce((a, b) => a + Number(b.total_cost), 0);
        const totalTokens = data.byService.reduce((a, b) => a + Number(b.total_tokens), 0);
        const totalCalls = data.byService.reduce((a, b) => a + Number(b.total_calls), 0);
        const avgCost = totalCalls ? (totalCost / totalCalls * 1000) : 0;

        document.getElementById('cost-total').textContent = fmt.usd(totalCost);
        document.getElementById('cost-tokens').textContent = fmt.num(totalTokens);
        document.getElementById('cost-calls').textContent = fmt.num(totalCalls);
        document.getElementById('cost-avg').textContent = fmt.usd(avgCost);

        // Alerts
        const alertsEl = document.getElementById('cost-alerts');
        alertsEl.innerHTML = data.alerts.length
            ? data.alerts.map(a => `<div class="alert-chip">${a.service} / ${a.team}: ${fmt.usd(a.daily_cost)} today</div>`).join('')
            : '';

        // Daily chart
        buildChart('dailyCostChart', 'line',
            data.daily.map(d => d.day),
            [{
                label: 'Daily Cost (USD)',
                data: data.daily.map(d => Number(d.total_cost).toFixed(4)),
                borderColor: '#f9c74f',
                backgroundColor: '#f9c74f22',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: '#f9c74f',
            }]
        );

        // Team doughnut
        buildChart('teamCostChart', 'doughnut',
            data.byTeam.map(t => t.team),
            [{
                data: data.byTeam.map(t => Number(t.total_cost).toFixed(4)),
                backgroundColor: CH_COLORS,
                borderWidth: 2,
                borderColor: '#0d0f17',
            }],
            { plugins: { legend: { position: 'right' } }, extra: { cutout: '60%', radius: '90%' } }
        );

        // Per-service table
        const maxCost = Math.max(...data.byService.map(s => Number(s.total_cost)));
        const tableEl = document.getElementById('servicesCostTable');
        tableEl.innerHTML = `
      <div class="sct-row">
        <span>Service</span><span>Total Cost</span><span>API Calls</span><span>Tokens</span><span>$/1k calls</span>
      </div>
      ${data.byService.map(s => {
            const cost = Number(s.total_cost);
            const pct = maxCost ? (cost / maxCost * 100) : 0;
            return `
          <div class="sct-row">
            <div>
              <div style="color:var(--text);font-weight:600">${s.service}</div>
              <div class="sct-bar" style="width:${pct}%"></div>
            </div>
            <span style="color:var(--ch-yellow)">${fmt.usd(cost)}</span>
            <span>${fmt.num(s.total_calls)}</span>
            <span>${fmt.num(s.total_tokens)}</span>
            <span>${fmt.usd(Number(s.avg_cost_per_call) * 1000)}</span>
          </div>
        `;
        }).join('')}
    `;
    } catch (e) {
        console.error('Cost load error:', e);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// ENGINES
// ════════════════════════════════════════════════════════════════════════════════
async function runEngineDemo(demoKey) {
    const resultEl = document.getElementById(`result-${demoKey}`);
    if (!resultEl) return;
    resultEl.innerHTML = '<em style="color:var(--text3)">⏳ Querying…</em>';
    try {
        const r = await fetch(`${API}/engines/${demoKey}`);
        const data = await r.json();
        if (data.error) { resultEl.innerHTML = `<span style="color:var(--red)">${data.error}</span>`; return; }

        const rows = data.data;
        if (!rows || !rows.length) { resultEl.textContent = 'No rows returned.'; return; }

        const cols = Object.keys(rows[0]);
        resultEl.innerHTML = `
      <div style="font-size:10px;color:var(--text3);margin-bottom:6px">Engine: ${data.engine || ''} | ${rows.length} rows returned</div>
      <table>
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 10).map(r => `<tr>${cols.map(c => `<td>${r[c]}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `;
    } catch (e) {
        resultEl.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// SQL PLAYGROUND
// ════════════════════════════════════════════════════════════════════════════════
const QUERIES = {
    eventsByHour: `-- Events per hour by type (MergeTree ORDER BY scan)
SELECT
  toStartOfHour(timestamp) AS hour,
  event_type,
  count() AS events,
  uniq(user_id) AS unique_users
FROM telemetry_events
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY hour, event_type
ORDER BY hour DESC, events DESC
LIMIT 30;`,

    topUsers: `-- Top 10 most active users
SELECT
  user_id,
  count() AS total_events,
  uniq(service) AS services_used,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM telemetry_events
GROUP BY user_id
ORDER BY total_events DESC
LIMIT 10;`,

    errorRate: `-- Error rate over the last 24h by service
SELECT
  service,
  countIf(level = 'ERROR') AS errors,
  countIf(level = 'WARN')  AS warnings,
  count()                   AS total,
  round(100.0 * countIf(level = 'ERROR') / count(), 2) AS error_pct
FROM app_logs
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY service
ORDER BY error_pct DESC;`,

    costByService: `-- Cost breakdown by service using SummingMergeTree
-- Note: SUM is maintained automatically on background merges!
SELECT
  service,
  team,
  sum(cost_usd)    AS total_cost,
  sum(api_calls)   AS total_calls,
  sum(tokens_used) AS total_tokens,
  round(sum(cost_usd) / sum(api_calls) * 1000, 4) AS cost_per_1k
FROM cost_usage
GROUP BY service, team
ORDER BY total_cost DESC;`,

    p95Latency: `-- P95 latency by service (works on MergeTree)
SELECT
  service,
  count() AS events,
  round(avg(duration_ms)) AS avg_ms,
  quantile(0.50)(duration_ms) AS p50_ms,
  quantile(0.95)(duration_ms) AS p95_ms,
  quantile(0.99)(duration_ms) AS p99_ms
FROM telemetry_events
GROUP BY service
ORDER BY p95_ms DESC;`,

    uniqueUsers: `-- HyperLogLog cardinality estimation (uniq)
-- uniq uses HLL sketches for O(1) memory regardless of cardinality
SELECT
  service,
  uniq(user_id)          AS hll_unique_users,
  uniqExact(user_id)     AS exact_unique_users,
  count()                AS total_events
FROM telemetry_events
GROUP BY service
ORDER BY total_events DESC;`,

    systemTables: `-- Explore ClickHouse system tables
SELECT
  name,
  engine,
  formatReadableSize(total_bytes) AS disk_size,
  total_rows,
  comment
FROM system.tables
WHERE database = 'demo'
ORDER BY total_bytes DESC;`,

    budgetCollapsing: `-- CollapsingMergeTree: net budget after corrections
-- sign=+1 rows add, sign=-1 rows cancel previous values
SELECT
  team,
  sum(budget_usd * sign) AS effective_budget,
  sumIf(budget_usd, sign = 1)  AS inserted,
  sumIf(budget_usd, sign = -1) AS cancelled
FROM budget_limits
GROUP BY team
HAVING effective_budget > 0
ORDER BY effective_budget DESC;`,

    ttlCheck: `-- Check TTL definitions on tables
SELECT
  database, name, engine, ttl_expression
FROM system.tables
WHERE database = 'demo'
  AND ttl_expression != ''
ORDER BY name;`,
};

function setQuery(sql) {
    document.getElementById('queryEditor').value = sql;
    document.getElementById('queryResultsWrap').style.display = 'none';
    document.getElementById('queryStatus').textContent = '';
}

function clearQuery() {
    document.getElementById('queryEditor').value = '';
    document.getElementById('queryResultsWrap').style.display = 'none';
    document.getElementById('queryStatus').textContent = '';
}

async function runQuery() {
    const sql = document.getElementById('queryEditor').value.trim();
    const status = document.getElementById('queryStatus');
    const wrap = document.getElementById('queryResultsWrap');
    if (!sql) { status.textContent = 'Please enter a SQL query.'; status.className = 'query-status err'; return; }

    status.className = 'query-status';
    status.textContent = '⏳ Running query…';
    wrap.style.display = 'none';

    const t0 = Date.now();
    try {
        const r = await fetch(`${API}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql }),
        });
        const data = await r.json();
        const ms = Date.now() - t0;

        if (data.error) {
            status.textContent = `❌ Error: ${data.error}`;
            status.className = 'query-status err';
            return;
        }

        lastQueryResults = data.rows;
        status.textContent = `✅ ${data.count} row${data.count !== 1 ? 's' : ''} in ${ms}ms`;
        status.className = 'query-status ok';

        if (!data.rows.length) { wrap.style.display = 'none'; return; }

        const cols = Object.keys(data.rows[0]);
        const table = document.getElementById('resultsTable');
        table.innerHTML = `
      <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>
        ${data.rows.map(row => `<tr>${cols.map(c => `<td>${escHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}
      </tbody>
    `;
        document.getElementById('resultsCount').textContent = `${data.count} row${data.count !== 1 ? 's' : ''}`;
        wrap.style.display = 'block';
    } catch (e) {
        status.textContent = `❌ Network error: ${e.message}`;
        status.className = 'query-status err';
    }
}

function copyResults() {
    navigator.clipboard.writeText(JSON.stringify(lastQueryResults, null, 2));
}

async function loadPlaygroundTables() {
    try {
        const r = await fetch(`${API}/engines`);
        const data = await r.json();
        const el = document.getElementById('playground-tables');
        el.innerHTML = data.map(t => `
      <div class="table-pill">
        <span>${t.name}</span>
        <span class="engine">${t.engine?.replace('MergeTree', 'MT') || ''}</span>
      </div>
    `).join('');
    } catch (e) {
        document.getElementById('playground-tables').textContent = 'Error loading tables.';
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ════════════════════════════════════════════════════════════════════════════════
// CLUSTER & REPLICATION
// ════════════════════════════════════════════════════════════════════════════════
async function loadCluster() {
    await Promise.all([
        loadClusterHealth(),
        loadClusterTopology(),
        loadShardCounts(),
        loadReplRowCounts(),
    ]);
}

async function loadClusterHealth() {
    try {
        const r = await fetch(`${API}/cluster/health`);
        const data = await r.json();
        data.nodes.forEach((node, idx) => {
            const n = idx + 1;
            const box = document.getElementById(`nodeStatusBox${n}`);
            const st = document.getElementById(`ca-node${n}-status`);
            if (!box || !st) return;
            if (node.status === 'up') {
                box.classList.add('node-up');
                box.querySelector('.ca-icon').textContent = '🟢';
                st.textContent = `v${node.ver?.slice(0, 6)} | shard=${node.shard} replica=${node.replica}`;
                st.style.color = 'var(--green)';
            } else {
                box.classList.add('node-down');
                box.querySelector('.ca-icon').textContent = '🔴';
                st.textContent = node.error || 'down';
                st.style.color = 'var(--red)';
            }
        });
    } catch { /* nodes offline */ }
}

async function loadClusterTopology() {
    const tbody = document.getElementById('topoTableBody');
    try {
        const r = await fetch(`${API}/cluster/topology`);
        const rows = await r.json();
        if (rows.error) throw new Error(rows.error);
        tbody.innerHTML = rows.map(r => `
      <tr>
        <td><span style="color:var(--ch-yellow);font-weight:600">${r.cluster}</span></td>
        <td>Shard ${r.shard_num}</td>
        <td>Replica ${r.replica_num}</td>
        <td style="font-family:var(--mono);color:var(--accent2)">${r.host_name}</td>
        <td style="font-family:var(--mono)">${r.port}</td>
        <td>${r.is_local ? '<span style="color:var(--green)">✓ local</span>' : '<span style="color:var(--text3)">remote</span>'}</td>
      </tr>
    `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-row" style="color:var(--red)">Node offline – start the cluster first: docker compose up -d clickhouse-node1 clickhouse-node2</td></tr>`;
    }
}

async function loadShardCounts() {
    try {
        const r = await fetch(`${API}/cluster/shard-counts`);
        const data = await r.json();
        if (data.error) throw new Error(data.error);

        // Bar chart showing rows per shard
        buildChart('shardDistChart', 'bar',
            data.shards.map(s => s.node),
            [{
                label: 'Rows on Shard',
                data: data.shards.map(s => s.rows),
                backgroundColor: ['#f9c74f88', '#6366f188'],
                borderColor: ['#f9c74f', '#6366f1'],
                borderWidth: 2,
                borderRadius: 6,
            }]
        );
    } catch { /* offline */ }
}

async function loadReplRowCounts() {
    const el = document.getElementById('repl-row-counts');
    try {
        const r = await fetch(`${API}/cluster/replication-status`);
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        el.innerHTML = data.rowCounts.map(rc => `
      <div class="repl-count-card">
        <div class="repl-count-num">${fmt.num(rc.rows)}</div>
        <div class="repl-count-label">${rc.replica}</div>
      </div>
    `).join('');
    } catch {
        el.innerHTML = '<div style="color:var(--text3);font-size:12px">Cluster nodes offline</div>';
    }
}

async function insertAndRoute() {
    const userId = document.getElementById('shard-user-id').value || 'user-42';
    const service = document.getElementById('shard-service').value;
    const el = document.getElementById('shard-route-result');
    el.className = 'shard-route-result show';
    el.textContent = '⏳ Inserting and routing…';
    try {
        const r = await fetch(`${API}/cluster/insert-and-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, service }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        el.innerHTML = `
      <div>User ID: <strong style="color:var(--ch-yellow)">${d.user_id}</strong></div>
      <div>Shard Key: <strong style="color:var(--accent2)">${d.shardKey}</strong></div>
      <div>Routed to: <strong style="color:var(--green)">${d.actualShard}</strong></div>
      <div style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
        Node1 rows for this user: <strong>${d.node1Rows}</strong> &nbsp;|&nbsp;
        Node2 rows for this user: <strong>${d.node2Rows}</strong>
      </div>
    `;
        setTimeout(loadShardCounts, 300);
    } catch (e) {
        el.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    }
}

async function runDistributedQuery() {
    const el = document.getElementById('distributed-result');
    el.innerHTML = '<em style="color:var(--text3)">⏳ Running cross-shard query…</em>';
    try {
        const r = await fetch(`${API}/cluster/distributed-query`);
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        const rows = data.rows;
        if (!rows?.length) { el.textContent = 'No rows.'; return; }
        const cols = Object.keys(rows[0]);
        el.innerHTML = `
      <div style="font-size:10px;color:var(--text3);margin-bottom:6px">
        Cross-shard SELECT via Distributed table — results merged from ALL shards
      </div>
      <table>
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 10).map(r => `<tr>${cols.map(c => `<td>${r[c]}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `;
    } catch (e) {
        el.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    }
}

async function runReplicationDemo() {
    const btn = document.getElementById('replBtn');
    const el = document.getElementById('repl-result');
    btn.disabled = true;
    btn.textContent = '⏳ Writing + waiting for sync…';
    el.className = 'repl-result show';
    el.textContent = '⏳ INSERT on node1 → waiting 1.5s → checking node2…';
    try {
        const r = await fetch(`${API}/cluster/replicate-demo`, { method: 'POST' });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        if (d.replicated) {
            el.innerHTML = `
        <div class="repl-success">✅ Replication confirmed!</div>
        <div>Written to: <strong>${d.insertedOnNode}</strong></div>
        <div>Found on node2 before wait: <strong>${d.foundOnNode2Before}</strong></div>
        <div>Found on node2 after 1.5s: <strong style="color:var(--green)">${d.foundOnNode2After}</strong></div>
        <div style="margin-top:6px;color:var(--text3)">ClickHouse Keeper synced the INSERT log automatically 🎉</div>
      `;
        } else {
            el.innerHTML = `
        <div class="repl-warn">⚠️ Not yet replicated (replication queue may be delayed)</div>
        <div>Written to: <strong>${d.insertedOnNode}</strong></div>
        <div>Found on node2: <strong>${d.foundOnNode2After}</strong></div>
        <div style="margin-top:6px;color:var(--text3)">Retry in a few seconds — replication is asynchronous.</div>
      `;
        }
        setTimeout(loadReplRowCounts, 500);
    } catch (e) {
        el.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    } finally {
        btn.disabled = false;
        btn.textContent = '✍️ Write to node1 → Verify on node2';
    }
}

async function loadReplStatus() {
    const el = document.getElementById('repl-status-result');
    el.innerHTML = '<em style="color:var(--text3)">⏳ Querying system.replicas…</em>';
    try {
        const r = await fetch(`${API}/cluster/replication-status`);
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        const cols = data.replicaInfo.length ? Object.keys(data.replicaInfo[0]) : [];
        el.innerHTML = cols.length ? `
      <table>
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${data.replicaInfo.map(r => `<tr>${cols.map(c => `<td>${r[c]}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    ` : '<span style="color:var(--text3)">No replicas registered yet.</span>';
    } catch (e) {
        el.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// AI ASSISTANT
// ════════════════════════════════════════════════════════════════════════════════

// Show one AI sub-section (chat / insights / rag)
function showAISection(name) {
    ['chat', 'insights', 'rag'].forEach(s => {
        document.getElementById(`ai-section-${s}`).style.display = s === name ? '' : 'none';
    });
}

// Check Ollama health + update UI badges
async function checkAIStatus() {
    const dot = document.getElementById('ai-status-dot');
    const hdr = document.getElementById('ai-header-status');
    const banner = document.getElementById('ai-status-banner');
    try {
        const r = await fetch(`${API}/ai/status`);
        const d = await r.json();
        if (d.ollama === 'running' && d.llmReady && d.embedReady) {
            dot.className = 'ai-badge ready';
            hdr.textContent = `✓ Ollama running · ${d.models.join(', ')}`;
            banner.style.display = 'none';
        } else if (d.ollama === 'running') {
            dot.className = 'ai-badge';
            const missing = [!d.llmReady && 'llama3.2', !d.embedReady && 'nomic-embed-text'].filter(Boolean);
            hdr.textContent = `⚠ Ollama running, missing: ${missing.join(', ')}`;
            banner.className = 'ai-status-banner glass error';
            banner.style.display = '';
            banner.textContent = `Run: ollama pull ${missing.join(' && ollama pull ')}`;
        } else {
            throw new Error('Ollama not running');
        }
    } catch {
        dot.className = 'ai-badge error';
        hdr.textContent = '✗ Ollama offline';
        banner.className = 'ai-status-banner glass error';
        banner.style.display = '';
        banner.innerHTML = `⚠️ Ollama is not running. Start it: <code>ollama serve</code> — then pull models: <code>ollama pull llama3.2 && ollama pull nomic-embed-text</code>`;
    }
}

// ─── J1: Text-to-SQL Chat ─────────────────────────────────────────────────────
function appendChatMsg(cls, html) {
    const msgs = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `chat-msg ${cls}`;
    div.innerHTML = html;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
}

async function sendChatMessage() {
    const inp = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    const q = inp.value.trim();
    if (!q) return;

    inp.value = '';
    inp.disabled = true;
    btn.disabled = true;
    btn.textContent = '⏳';

    appendChatMsg('user', escHtml(q));
    const thinking = appendChatMsg('thinking', 'Generating SQL…');

    try {
        const r = await fetch(`${API}/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q }),
        });
        const d = await r.json();
        thinking.remove();

        if (d.error) {
            appendChatMsg('assistant', `<div class="chat-answer" style="color:var(--red)">❌ ${escHtml(d.error)}</div>`);
            return;
        }

        const sqlId = `sql-${Date.now()}`;
        appendChatMsg('assistant', `
            <div class="chat-answer">${escHtml(d.answer)}</div>
            <div class="chat-sql-reveal" onclick="toggle('${sqlId}')">▸ Show generated SQL &amp; ${d.rowCount} result${d.rowCount !== 1 ? 's' : ''}</div>
            <div class="chat-sql-block" id="${sqlId}">${escHtml(d.sql)}</div>
        `);
    } catch (e) {
        thinking.remove();
        appendChatMsg('assistant', `<div class="chat-answer" style="color:var(--red)">❌ Network error: ${escHtml(e.message)}</div>`);
    } finally {
        inp.disabled = false;
        btn.disabled = false;
        btn.textContent = 'Ask →';
        inp.focus();
    }
}

function toggle(id) {
    const el = document.getElementById(id);
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

function askSuggested(q) {
    document.getElementById('chatInput').value = q;
    sendChatMessage();
}

// ─── J2: AI Insights Agent ────────────────────────────────────────────────────
async function runInsightsAgent() {
    const btn = document.getElementById('insightsRunBtn');
    const section = document.getElementById('insightsSection').value;
    const el = document.getElementById('insightsResult');

    btn.disabled = true;
    btn.textContent = '⏳ Analyzing data…';
    el.innerHTML = '<div class="insight-card info"><div class="insight-detail">Running diagnostic queries across all tables, then asking the LLM to find patterns…</div></div>';

    try {
        const r = await fetch(`${API}/ai/insights?section=${section}`);
        const d = await r.json();

        if (d.error) { el.innerHTML = `<div class="insight-card critical"><div class="insight-detail">❌ ${escHtml(d.error)}</div></div>`; return; }

        const icons = { critical: '🔴', warning: '🟡', info: '🔵' };
        el.innerHTML = (d.insights || []).map(i => `
            <div class="insight-card ${i.severity}">
                <div class="insight-title">
                    ${icons[i.severity] || '·'}
                    ${escHtml(i.title)}
                    <span class="insight-severity severity-${i.severity}">${i.severity}</span>
                </div>
                <div class="insight-detail">${escHtml(i.detail)}</div>
                ${i.recommendation ? `<div class="insight-rec">${escHtml(i.recommendation)}</div>` : ''}
            </div>
        `).join('');

        if (!d.insights?.length) el.innerHTML = '<div class="insight-card info"><div class="insight-detail">No insights returned. Try a different section.</div></div>';
    } catch (e) {
        el.innerHTML = `<div class="insight-card critical"><div class="insight-detail">❌ ${escHtml(e.message)}</div></div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Run Insights Agent';
    }
}

// ─── J3: RAG ─────────────────────────────────────────────────────────────────
async function runRAGQuery() {
    const q = document.getElementById('ragInput').value.trim();
    const btn = document.getElementById('ragBtn');
    const el = document.getElementById('ragResult');
    if (!q) return;

    btn.disabled = true;
    btn.textContent = '⏳';
    el.innerHTML = '<div class="rag-answer-card"><div class="insight-detail">Embedding question → cosineDistance search → retrieving context…</div></div>';

    try {
        const r = await fetch(`${API}/ai/rag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q }),
        });
        const d = await r.json();

        if (d.error) { el.innerHTML = `<div class="rag-answer-card" style="color:var(--red)">❌ ${escHtml(d.error)}</div>`; return; }

        el.innerHTML = `
            <div class="rag-answer-card">
                <div class="rag-answer-text">${escHtml(d.answer)}</div>
                <div class="rag-sources">📦 Sources: ${(d.sources || []).map(s => `<code>${s}</code>`).join(', ') || 'none'}</div>
                <div class="section-title" style="margin-top:12px;margin-bottom:8px">Retrieved Chunks (cosineDistance)</div>
                <div class="rag-chunks">
                    ${(d.retrievedChunks || []).map((c, i) => `
                        <div class="rag-chunk">
                            <div class="rag-chunk-meta">
                                <span>[${i + 1}] ${c.source}/${c.category}</span>
                                <span>distance: ${c.distance}</span>
                            </div>
                            ${escHtml(c.content)}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } catch (e) {
        el.innerHTML = `<div class="rag-answer-card" style="color:var(--red)">❌ ${escHtml(e.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Search';
    }
}

function askRAG(q) {
    document.getElementById('ragInput').value = q;
    runRAGQuery();
}

async function indexDocument() {
    const source = document.getElementById('ragIndexSource').value.trim();
    const category = document.getElementById('ragIndexCategory').value.trim();
    const text = document.getElementById('ragIndexText').value.trim();
    const el = document.getElementById('ragIndexResult');
    if (!text) { el.style.color = 'var(--red)'; el.textContent = 'Please enter some text to index.'; return; }

    el.style.color = 'var(--text3)';
    el.textContent = '⏳ Embedding and indexing into ClickHouse…';
    try {
        const r = await fetch(`${API}/ai/rag/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, category, text }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        el.style.color = 'var(--green)';
        el.textContent = `✅ Indexed ${d.chunksIndexed} chunk(s) into demo.knowledge_embeddings. Try searching for it above!`;
        document.getElementById('ragIndexText').value = '';
    } catch (e) {
        el.style.color = 'var(--red)';
        el.textContent = `❌ ${e.message}`;
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
checkHealth();
setInterval(checkHealth, 30_000);

// Poll AI status dot every 60s when Ollama might still be starting
setTimeout(async () => {
    const dot = document.getElementById('ai-status-dot');
    if (!dot?.classList.contains('ready')) {
        const r = await fetch(`${API}/ai/status`).catch(() => null);
        if (r?.ok) {
            const d = await r.json();
            if (d.llmReady && d.embedReady) {
                dot.className = 'ai-badge ready';
            }
        }
    }
}, 5000);

// Keyboard shortcut: Ctrl/Cmd+Enter to run query
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const active = document.querySelector('.tab-panel.active');
        if (active?.id === 'tab-query') runQuery();
    }
});
