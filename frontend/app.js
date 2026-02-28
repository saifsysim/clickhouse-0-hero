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
  // Learning Guide – no data to load, just show
}

// Navigate to a tab from within the Learning Guide (without needing a button ref)
function goToTab(tab) {
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  switchTab(tab, btn);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show a guide module, update progress bar + sidebar active state
function showGuideModule(num, btn) {
  const total = 7; // update this when adding AI modules in addAI branch
  document.querySelectorAll('.guide-lesson').forEach(l => l.style.display = 'none');
  document.querySelectorAll('.guide-mod-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`glesson-${num}`).style.display = '';
  if (btn) btn.classList.add('active');
  const pct = (num / total * 100).toFixed(1);
  document.getElementById('guideProgBar').style.width = pct + '%';
  document.getElementById('guideProgLbl').textContent = `Module ${num} of ${total}`;
  // Smooth scroll to top of guide content
  document.querySelector('.guide-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

// ─── Init ─────────────────────────────────────────────────────────────────────
checkHealth();
setInterval(checkHealth, 30_000);

// Keyboard shortcut: Ctrl/Cmd+Enter to run query
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const active = document.querySelector('.tab-panel.active');
    if (active?.id === 'tab-query') runQuery();
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 13 MISTAKES TAB
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Filter the mistake cards by category tag.
 * @param {string} category - 'all' | 'ingestion' | 'schema' | 'query' | 'ops' | 'views'
 * @param {HTMLElement} btn - the filter button that was clicked
 */
function filterMistakes(category, btn) {
  // Update active button
  document.querySelectorAll('.mf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Show / hide cards
  document.querySelectorAll('#mistakesGrid .mistake-card').forEach(card => {
    const match = category === 'all' || card.dataset.category === category;
    card.style.display = match ? '' : 'none';
  });
}

/**
 * Toggle a mistake card body open / closed.
 * @param {HTMLElement} toggleBtn - the ▼ button inside the card header
 */
function toggleMistake(toggleBtn) {
  const card = toggleBtn.closest('.mistake-card');
  const body = card.querySelector('.mistake-body');
  const isCollapsed = body.classList.contains('collapsed');

  if (isCollapsed) {
    // Expand
    body.classList.remove('collapsed');
    toggleBtn.classList.remove('collapsed');
    toggleBtn.textContent = '▼';
  } else {
    // Collapse
    body.classList.add('collapsed');
    toggleBtn.classList.add('collapsed');
    toggleBtn.textContent = '▶';
  }
}

// Make header row itself also toggle the card
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.mistake-card-header').forEach(header => {
    header.addEventListener('click', e => {
      // Avoid double-firing if the toggle button itself was clicked
      if (e.target.closest('.mistake-toggle')) return;
      const toggleBtn = header.querySelector('.mistake-toggle');
      if (toggleBtn) toggleMistake(toggleBtn);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 13 MISTAKES: LIVE DEMO RUNNERS
// ════════════════════════════════════════════════════════════════════════════════

/** Generic GET demo runner — routes to the right renderer by endpoint key */
async function runMistakeDemo(key, btn) {
  const el = document.getElementById(`demo-${key}`);
  if (!el) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '⏳ Running…';
  el.innerHTML = '<span class="ldp-loading">⏳ Querying ClickHouse…</span>';

  try {
    const r = await fetch(`${API}/mistakes/${key}`);
    const data = await r.json();
    if (data.error) {
      el.innerHTML = `<span class="ldp-error">❌ ${escHtml(data.error)}</span>`;
      return;
    }
    // Route to the right renderer
    if (key === 'parts') renderPartsDemo(el, data);
    else if (key === 'nullable-cost') renderNullableCostDemo(el, data);
    else if (key === 'pk-explain') renderPkExplainDemo(el, data);
    else if (key === 'limit-demo') renderLimitDemo(el, data);
    else if (key === 'query-memory') renderQueryMemoryDemo(el, data);
    else if (key === 'mv-status') renderMvStatusDemo(el, data);
    else el.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  } catch (e) {
    el.innerHTML = `<span class="ldp-error">❌ Backend offline — start the server first: <code>npm start</code></span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/** POST demo runner (dedup — needs to write data) */
async function runMistakeDemoPost(key, btn) {
  const el = document.getElementById(`demo-${key}`);
  if (!el) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '⏳ Running…';
  el.innerHTML = '<span class="ldp-loading">⏳ Inserting 3 rows twice, counting…</span>';

  try {
    const r = await fetch(`${API}/mistakes/${key}`, { method: 'POST' });
    const data = await r.json();
    if (data.error) { el.innerHTML = `<span class="ldp-error">❌ ${escHtml(data.error)}</span>`; return; }
    if (key === 'dedup-demo') renderDedupDemo(el, data);
  } catch (e) {
    el.innerHTML = `<span class="ldp-error">❌ Backend offline — start the server first.</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Renderer #01: Parts inspector ────────────────────────────────────────────
function renderPartsDemo(el, data) {
  const threshold = r => {
    const n = Number(r.active_parts);
    if (n > 1000) return 'bad';
    if (n > 300) return 'hi';
    return 'ok';
  };
  el.innerHTML = `
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">
        💡 ${escHtml(data.tip)}
      </div>
      <table>
        <thead><tr>
          <th>Table</th><th>Active Parts</th><th>Total Rows</th>
          <th>Compressed Size</th><th>Last Modified</th>
        </tr></thead>
        <tbody>${data.rows.map(r => `
          <tr>
            <td class="hi">${r.table}</td>
            <td class="${threshold(r)}">${r.active_parts}</td>
            <td>${Number(r.total_rows).toLocaleString()}</td>
            <td>${r.compressed_size}</td>
            <td style="color:var(--text3)">${String(r.last_modified).slice(0, 19)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
}

// ── Renderer #05: Nullable / column cost ─────────────────────────────────────
function renderNullableCostDemo(el, data) {
  const rows = data.columns;
  el.innerHTML = `
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">
        💡 ${escHtml(data.tip)}
      </div>
      <table>
        <thead><tr>
          <th>Table</th><th>Column</th><th>Type</th>
          <th>Compressed</th><th>Uncompressed</th><th>Ratio</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td style="color:var(--text3)">${r.table}</td>
            <td class="hi">${r.name}</td>
            <td>
              ${r.isNullable
      ? `<span class="ldp-col-tag bad" style="background:rgba(239,68,68,.15);color:#fca5a5">Nullable</span> `
      : r.isLowCardinality
        ? `<span class="ldp-col-tag lc">LowCardinality</span> `
        : `<span class="ldp-col-tag str">String/Num</span> `}
              <span style="color:var(--text3);font-size:10px">${r.type}</span>
            </td>
            <td class="ok">${r.compressed}</td>
            <td>${r.uncompressed}</td>
            <td class="${Number(r.compression_ratio) > 3 ? 'ok' : 'hi'}">${r.compression_ratio}×</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
}

// ── Renderer #06: Deduplication proof ────────────────────────────────────────
function renderDedupDemo(el, data) {
  const color = data.deduplicated ? '#6ee7b7' : '#fbbf24';
  const icon = data.deduplicated ? '✅' : '⚠️';
  el.innerHTML = `
      <div class="ldp-dedup-result">
        <div class="ldp-dedup-step insert1">
          <div class="ldp-dedup-count" style="color:var(--accent2)">${data.blockSize}</div>
          <div class="ldp-dedup-label">rows in block</div>
        </div>
        <div class="ldp-dedup-step insert1">
          <div class="ldp-dedup-count">${data.countAfterInsert1}</div>
          <div class="ldp-dedup-label">after insert #1</div>
        </div>
        <div class="ldp-dedup-step insert2">
          <div class="ldp-dedup-count" style="color:#fbbf24">${data.countAfterInsert2}</div>
          <div class="ldp-dedup-label">after insert #2<br>(same block)</div>
        </div>
        <div class="ldp-dedup-step result">
          <div class="ldp-dedup-count" style="color:${color}">${icon}</div>
          <div class="ldp-dedup-label">${data.deduplicated ? 'Deduplicated!' : 'Not deduped'}</div>
        </div>
      </div>
      <div style="font-size:11.5px;color:var(--text2);line-height:1.6">${escHtml(data.explanation)}</div>
    `;
}

// ── Renderer #07: PK EXPLAIN comparison ──────────────────────────────────────
function renderPkExplainDemo(el, data) {
  const formatExplain = rows => rows.map(r => Object.values(r).join(' ')).join('\n');
  el.innerHTML = `
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">
        Primary key: <code style="color:var(--ch-yellow)">${escHtml(data.primaryKey)}</code>
      </div>
      <div class="ldp-explain-compare">
        <div>
          <div class="ldp-explain-label" style="color:#fca5a5">❌ ${escHtml(data.bad.filter)}</div>
          <div class="ldp-explain-box bad-explain">${escHtml(formatExplain(data.bad.explain))}</div>
          <div style="font-size:11px;margin-top:4px;color:var(--text3)">Result: <strong style="color:var(--text)">${data.bad.result?.cnt ?? '—'}</strong> rows matched</div>
        </div>
        <div>
          <div class="ldp-explain-label" style="color:#6ee7b7">✅ ${escHtml(data.good.filter)}</div>
          <div class="ldp-explain-box good-explain">${escHtml(formatExplain(data.good.explain))}</div>
          <div style="font-size:11px;margin-top:4px;color:var(--text3)">Result: <strong style="color:var(--text)">${data.good.result?.cnt ?? '—'}</strong> rows matched</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3)">Look for <code>Granules: N/M</code> in the EXPLAIN output — the good query reads far fewer granules.</div>
    `;
}

// ── Renderer #09: LIMIT timing ────────────────────────────────────────────────
function renderLimitDemo(el, data) {
  const improved = data.speedupMs > 0;
  el.innerHTML = `
      <div class="ldp-speed-compare">
        <div class="ldp-speed-box slow">
          <div class="ldp-speed-label">❌ Default (no optimization)</div>
          <div class="ldp-speed-ms">${data.slow.ms} <span>ms</span></div>
          <div class="ldp-speed-note">${escHtml(data.slow.setting)}</div>
        </div>
        <div class="ldp-speed-box fast">
          <div class="ldp-speed-label">✅ optimize_aggregation_in_order = 1</div>
          <div class="ldp-speed-ms">${data.fast.ms} <span>ms</span></div>
          <div class="ldp-speed-note">${escHtml(data.fast.setting)}</div>
        </div>
      </div>
      ${improved
      ? `<div class="ldp-speedup-badge">⚡ ${data.speedupMs}ms faster — ${data.speedupPct}% speedup on this dataset</div>`
      : `<div style="font-size:11px;color:var(--text3)">⚠️ On small datasets the setting may not show a large difference — the effect is dramatic on millions of rows.</div>`}
      <div style="font-size:11px;color:var(--text3)">Same query, same result: <code>${data.fast.row ? Object.values(data.fast.row).join(' / ') : '—'}</code></div>
    `;
}

// ── Renderer #11: Query memory ───────────────────────────────────────────────
function renderQueryMemoryDemo(el, data) {
  if (!data.rows || !data.rows.length) {
    el.innerHTML = `<span style="color:var(--text3)">No recent queries in system.query_log yet — run some queries first.</span>`;
    return;
  }
  el.innerHTML = `
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">
        📊 Top queries by memory usage in the last 5 minutes (from <code>system.query_log</code>)
      </div>
      <table>
        <thead><tr>
          <th>Query</th><th>Memory (MB)</th><th>Rows Read</th><th>Read Size</th><th>Duration (ms)</th>
        </tr></thead>
        <tbody>${data.rows.map(r => `
          <tr>
            <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${escHtml(r.query_preview)}</td>
            <td class="${Number(r.memory_mb) > 50 ? 'bad' : Number(r.memory_mb) > 10 ? 'hi' : 'ok'}">${r.memory_mb}</td>
            <td>${Number(r.read_rows).toLocaleString()}</td>
            <td>${r.read_size}</td>
            <td>${r.duration_ms}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
}

// ── Renderer #12: Materialized View status ───────────────────────────────────
function renderMvStatusDemo(el, data) {
  el.innerHTML = `
      <div style="margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:6px">Views & Aggregating Tables</div>
        <table>
          <thead><tr><th>Name</th><th>Engine</th><th>Rows</th><th>Size</th></tr></thead>
          <tbody>${data.views.map(v => `
            <tr>
              <td class="hi">${v.name}</td>
              <td style="color:var(--accent2)">${v.engine}</td>
              <td>${Number(v.total_rows ?? 0).toLocaleString()}</td>
              <td>${v.size}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6ee7b7;margin-bottom:6px">✅ Via MV (pre-aggregated)</div>
          <table>
            <thead><tr><th>Service</th><th>Event</th><th>MV Count</th><th>p95 ms</th></tr></thead>
            <tbody>${(data.mvAggregated || []).map(r => `
              <tr>
                <td>${r.service}</td><td>${r.event_type}</td>
                <td class="ok">${Number(r.total_events).toLocaleString()}</td>
                <td>${r.p95_ms}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--accent2);margin-bottom:6px">📊 Direct source count</div>
          <table>
            <thead><tr><th>Service</th><th>Event</th><th>Actual Count</th></tr></thead>
            <tbody>${(data.sourceCount || []).map(r => `
              <tr>
                <td>${r.service}</td><td>${r.event_type}</td>
                <td class="hi">${Number(r.direct_count).toLocaleString()}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.6">
        💡 ${escHtml(data.note)}
      </div>
    `;
}

// ════════════════════════════════════════════════════════════════════════════════
// 13 MISTAKES v2 — Wrong / Fixed / Reset runners
// ════════════════════════════════════════════════════════════════════════════════

/** Unified runner for Wrong / Fixed / Reset modes */
async function _runMode(key, mode, btn) {
  const paneId = mode === 'wrong' ? `wrong-${key}` : mode === 'fixed' ? `fixed-${key}` : null;
  const splitEl = document.getElementById(`split-${key}`);
  const el = paneId ? document.getElementById(paneId) : null;

  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳…';
  if (el) el.innerHTML = `<span class="ldp-loading">⏳ Running against ClickHouse…</span>`;

  try {
    const r = await fetch(`${API}/mistakes/${key}-${mode}`, { method: 'POST' });
    const data = await r.json();
    if (data.error) {
      if (el) el.innerHTML = `<span class="ldp-error">❌ ${escHtml(data.error)}</span>`;
      return;
    }
    if (mode === 'reset') {
      if (splitEl) {
        // Reset both panes back to hints
        splitEl.querySelectorAll('.ldp-wrong-pane,.ldp-fixed-pane').forEach(p => {
          p.innerHTML = `<div class="ldp-pane-hint">${p.id.startsWith('wrong') ? 'Click ▶ Run ❌ Wrong to see the mistake' : 'Click ▶ Run ✅ Fixed to see the solution'}</div>`;
        });
      }
      // Show brief toast
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:10px 18px;border-radius:8px;font-size:12px;z-index:9999';
      toast.textContent = `↺ ${data.message || 'Reset complete'}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      return;
    }
    // Render the pane
    if (el) {
      el.innerHTML = '';
      renderPane(key, mode, el, data);
    }
  } catch (e) {
    if (el) el.innerHTML = `<span class="ldp-error">❌ Backend offline — make sure the server is running.</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function runWrong(key, btn) { _runMode(key, 'wrong', btn); }
function runFixed(key, btn) { _runMode(key, 'fixed', btn); }
function runReset(key, btn) { _runMode(key, 'reset', btn); }

/** Route to per-key, per-mode renderer */
function renderPane(key, mode, el, data) {
  const isWrong = mode === 'wrong';
  switch (key) {
    case 'parts': renderPartsPane(isWrong, el, data); break;
    case 'nullable': renderNullablePane(isWrong, el, data); break;
    case 'dedup': renderDedupPane(isWrong, el, data); break;
    case 'pk': renderPkPane(isWrong, el, data); break;
    case 'limit': renderLimitPane2(isWrong, el, data); break;
    case 'memory': renderMemoryPane(isWrong, el, data); break;
    case 'mv': renderMvPane2(isWrong, el, data); break;
  }
}

// ── #01 Parts ─────────────────────────────────────────────────────────────────
function renderPartsPane(isWrong, el, data) {
  const cls = isWrong ? 'bad' : 'good';
  const maxW = Math.min(data.parts * 12, 220);
  el.innerHTML = `
      <div class="ldp-pane-label ${isWrong ? 'wrong' : 'fixed'}">
        ${isWrong ? '❌ Wrong — one INSERT per row' : '✅ Fixed — one batch INSERT'}
      </div>
      <div class="ldp-stat-big ${cls}">${data.parts}</div>
      <div class="ldp-stat-label">active part${data.parts === 1 ? '' : 's'} created</div>
      <div class="parts-bar-wrap">
        <div class="parts-bar-row">
          <div class="parts-bar-fill ${isWrong ? '' : 'good'}" style="width:${maxW}px"></div>
          <span>${data.parts} part${data.parts === 1 ? '' : 's'} / ${data.totalRows} row${data.totalRows === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="ldp-stat-note">${escHtml(isWrong ? data.warning : data.tip)}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px">⏱ ${data.elapsedMs}ms for ${data.totalRows} rows</div>
    `;
}

// ── #05 Nullable ──────────────────────────────────────────────────────────────
function renderNullablePane(isWrong, el, data) {
  const cols = (data.columns || []).filter(c => c.name !== 'id');
  el.innerHTML = `
      <div class="ldp-pane-label ${isWrong ? 'wrong' : 'fixed'}">
        ${isWrong ? '❌ Nullable(String/Int) — null-map overhead' : '✅ DEFAULT values — no null bitmaps'}
      </div>
      <div style="margin-bottom:8px">
        ${cols.map(c => `
          <div class="ldp-col-row">
            <span class="ldp-col-name">${c.name}</span>
            <span class="ldp-col-type">${c.type}</span>
            <span class="ldp-col-size ${isWrong ? 'bad' : 'good'}">${c.compressed}</span>
          </div>`).join('')}
      </div>
      <div style="color:var(--text3);font-size:10px;font-family:var(--font);margin-top:4px">
        Total compressed: <strong style="color:${isWrong ? '#fca5a5' : '#6ee7b7'}">${data.totalCompressed}</strong> for ${data.rows} rows
      </div>
      <div class="ldp-stat-note">${escHtml(data.note)}</div>
    `;
}

// ── #06 Dedup ─────────────────────────────────────────────────────────────────
function renderDedupPane(isWrong, el, data) {
  if (isWrong) {
    const dup = data.duplicated;
    el.innerHTML = `
          <div class="ldp-pane-label wrong">❌ Non-replicated table — no dedup window</div>
          <div class="ldp-dedup-boxes">
            <div class="ldp-dbox" style="border-color:rgba(99,102,241,.3)">
              <div class="ldp-dbox-num" style="color:var(--accent2)">${data.blockSize}</div>
              <div class="ldp-dbox-lbl">rows in block</div>
            </div>
            <div class="ldp-dbox" style="border-color:rgba(99,102,241,.3)">
              <div class="ldp-dbox-num">${data.afterInsert1}</div>
              <div class="ldp-dbox-lbl">after insert #1</div>
            </div>
            <div class="ldp-dbox" style="border-color:${dup ? 'rgba(239,68,68,.4)' : 'rgba(16,185,129,.4)'}">
              <div class="ldp-dbox-num" style="color:${dup ? '#fca5a5' : '#6ee7b7'}">${data.afterInsert2}</div>
              <div class="ldp-dbox-lbl">after retry insert #2</div>
            </div>
          </div>
          <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(data.explanation)}</div>
        `;
  } else {
    const withoutF = data.withoutFinal || [];
    const withF = data.withFinal || [];
    el.innerHTML = `
          <div class="ldp-pane-label fixed">✅ ReplacingMergeTree + SELECT FINAL</div>
          <div style="font-size:10px;color:var(--text3);font-family:var(--font);margin-bottom:6px">Engine: <code>${data.withoutFinal ? 'ReplacingMergeTree(ver)' : ''}</code></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div>
              <div style="font-size:9px;color:#fca5a5;font-weight:700;text-transform:uppercase;margin-bottom:4px">Without FINAL (${withoutF.length} rows)</div>
              ${withoutF.map(r => `<div style="font-size:10.5px;font-family:var(--mono);color:var(--text2);padding:2px 0">${r.id} · ${r.user} · ${r.payload} · v${r.ver}</div>`).join('')}
            </div>
            <div>
              <div style="font-size:9px;color:#6ee7b7;font-weight:700;text-transform:uppercase;margin-bottom:4px">With FINAL (${withF.length} rows — deduped)</div>
              ${withF.map(r => `<div style="font-size:10.5px;font-family:var(--mono);color:#6ee7b7;padding:2px 0">${r.id} · ${r.user} · ${r.payload} · v${r.ver}</div>`).join('')}
            </div>
          </div>
          <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(data.tip)}</div>
        `;
  }
}

// ── #07 Primary Key EXPLAIN ───────────────────────────────────────────────────
function renderPkPane(isWrong, el, data) {
  const clr = isWrong ? '#fca5a5' : '#6ee7b7';
  const explainText = (data.explain || []).join('\n');
  el.innerHTML = `
      <div class="ldp-pane-label ${isWrong ? 'wrong' : 'fixed'}">
        ${isWrong ? '❌ Filter on user_id — NOT in primary key' : '✅ Filter on service — first ORDER BY column'}
      </div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--font);margin-bottom:6px">
        Query: <code style="color:${clr}">${escHtml(data.query)}</code>
      </div>
      <div style="font-size:10.5px;font-family:var(--mono);background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;max-height:160px;overflow-y:auto;white-space:pre-wrap;color:${clr}">${escHtml(explainText)}</div>
      <div style="font-family:var(--font);margin-top:8px;font-size:11px">
        <span style="color:var(--text3)">Result:</span> <strong style="color:var(--text)">${Number(data.resultCount).toLocaleString()}</strong> rows &nbsp;·&nbsp;
        <span style="color:var(--text3)">Time:</span> <strong style="color:${clr}">${data.elapsedMs}ms</strong>
      </div>
      <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(isWrong ? data.warning : data.tip)}</div>
    `;
}

// ── #09 LIMIT timing ─────────────────────────────────────────────────────────
function renderLimitPane2(isWrong, el, data) {
  const clr = isWrong ? '#fca5a5' : '#6ee7b7';
  el.innerHTML = `
      <div class="ldp-pane-label ${isWrong ? 'wrong' : 'fixed'}">
        ${isWrong ? '❌ Default — full scan before LIMIT' : '✅ optimize_aggregation_in_order = 1'}
      </div>
      <div class="ldp-stat-big ${isWrong ? 'bad' : 'good'}">${data.elapsedMs}<span style="font-size:16px;font-weight:400"> ms</span></div>
      <div class="ldp-stat-label">query elapsed time</div>
      <div style="font-size:10.5px;font-family:var(--mono);color:var(--text3);margin-top:6px">${escHtml(data.setting)}</div>
      <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(isWrong ? data.explanation : data.tip)}</div>
      ${data.result ? `<div style="font-size:10px;color:var(--text3);margin-top:4px;font-family:var(--font)">Result row: <code>${escHtml(JSON.stringify(data.result))}</code></div>` : ''}
    `;
}

// ── #11 Memory ────────────────────────────────────────────────────────────────
function renderMemoryPane(isWrong, el, data) {
  const log = data.queryLog;
  el.innerHTML = `
      <div class="ldp-pane-label ${isWrong ? 'wrong' : 'fixed'}">
        ${isWrong ? '❌ No memory limits — unguarded aggregation' : '✅ max_bytes_before_external_group_by — controlled spill'}
      </div>
      <div style="font-size:10.5px;font-family:var(--mono);color:var(--text3);margin-bottom:8px">${escHtml(data.setting)}</div>
      <div class="ldp-stat-big ${isWrong ? 'warn' : 'good'}">${data.elapsedMs}<span style="font-size:16px;font-weight:400"> ms</span></div>
      <div class="ldp-stat-label">elapsed</div>
      ${log ? `
        <div style="margin-top:10px;font-family:var(--font);font-size:11px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div><div style="color:var(--text3);font-size:9px;text-transform:uppercase">Memory Used</div><strong style="color:${isWrong ? '#fbbf24' : '#6ee7b7'}">${log.mb} MB</strong></div>
          <div><div style="color:var(--text3);font-size:9px;text-transform:uppercase">Rows Read</div><strong>${Number(log.read_rows).toLocaleString()}</strong></div>
          <div><div style="color:var(--text3);font-size:9px;text-transform:uppercase">Duration</div><strong>${log.query_duration_ms}ms</strong></div>
        </div>` : '<div style="font-size:10px;color:var(--text3);margin-top:6px;font-family:var(--font)">Check system.query_log manually — may not appear immediately.</div>'}
      <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(isWrong ? data.warning : data.tip)}</div>
    `;
}

// ── #12 Materialized Views ────────────────────────────────────────────────────
function renderMvPane2(isWrong, el, data) {
  if (isWrong) {
    el.innerHTML = `
          <div class="ldp-pane-label wrong">❌ MV created after ${Number(data.sourceRows).toLocaleString()} existing rows</div>
          <div class="ldp-stat-big bad">${data.mvRows}</div>
          <div class="ldp-stat-label">rows captured by MV</div>
          <div style="font-family:var(--font);font-size:11px;margin-top:8px;color:var(--text3)">
            Source table: <strong style="color:var(--text)">${Number(data.sourceRows).toLocaleString()}</strong> rows
          </div>
          <div style="font-family:var(--font);font-size:11px;color:#fbbf24;margin-top:4px">
            🚨 ${(data.sourceRows - data.mvRows).toLocaleString()} rows NOT captured — they existed before MV was created!
          </div>
          <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(data.problem)}</div>
        `;
  } else {
    const rows = data.rows || [];
    el.innerHTML = `
          <div class="ldp-pane-label fixed">✅ Backfill: INSERT INTO mv_target SELECT ... FROM source</div>
          <div class="ldp-stat-big good">${Number(data.grandTotal).toLocaleString()}</div>
          <div class="ldp-stat-label">total events now in MV target</div>
          <div style="margin-top:10px">
            ${rows.slice(0, 6).map(r => `<div class="ldp-mv-row"><span class="ldp-mv-svc">${r.service}</span><span class="ldp-mv-cnt" style="color:#6ee7b7">${Number(r.total).toLocaleString()}</span></div>`).join('')}
            ${rows.length > 6 ? `<div style="font-size:10px;color:var(--text3);margin-top:4px">+ ${rows.length - 6} more services</div>` : ''}
          </div>
          <div class="ldp-stat-note" style="font-family:var(--font)">${escHtml(data.tip)}</div>
        `;
  }
}
