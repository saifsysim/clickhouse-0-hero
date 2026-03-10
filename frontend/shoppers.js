/* ─────────────────────────────────────────────────────────────────────────────
   🛍️  Shoppers Paradise — ClickHouse Analytical Use Cases
   Multi-vendor shopping analytics scenario
   ────────────────────────────────────────────────────────────────── */

const SP_API = window.API || 'http://localhost:3001/api';

// ── Utility: simple table renderer ───────────────────────────────────────────
function spTable(rows, opts = {}) {
  if (!rows || !rows.length) return '<div class="sp-empty">No data returned. Make sure the database is seeded.</div>';
  const keys = Object.keys(rows[0]);
  const moneyKeys = new Set(['price', 'usd', 'cost', 'gmv', 'revenue', 'margin', 'earned', 'spent', 'savings', 'paid', 'cashback']);
  const pctKeys = new Set(['pct', 'rate', 'pct_drop', 'conv_pct', 'conversion_pct', 'leakage_pct', 'stock_pct', 'avg_pct', 'avg_cashback_pct']);
  const isMoneyCol = k => [...moneyKeys].some(m => k.toLowerCase().includes(m));
  const isPctCol = k => [...pctKeys].some(p => k.toLowerCase().includes(p));
  const isNumeric = v => v !== null && v !== undefined && !isNaN(Number(v)) && v !== '';
  let limit = opts.limit || rows.length;
  return `<table class="sp-tbl"><thead><tr>${keys.map(k => `<th>${k.replace(/_/g, ' ')}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, limit).map((r, ri) => `<tr>${keys.map(k => {
    const v = r[k];
    const n = Number(v);
    let cls = 'sp-cell';
    let display = v ?? '—';
    if (isNumeric(v)) {
      cls += ' sp-num';
      if (isMoneyCol(k)) { display = `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
      else if (isPctCol(k)) {
        display = `${v}%`;
        cls += n > 30 ? ' sp-green' : n > 15 ? ' sp-yellow' : n < 5 ? ' sp-red' : '';
      } else { display = parseFloat(v) === parseInt(v) ? Number(v).toLocaleString() : parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
    }
    return `<td class="${cls}">${display}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>
    ${rows.length > limit ? `<div class="sp-more">Showing ${limit} of ${rows.length} rows</div>` : ''}`;
}

// ── Utility: KPI card strip ───────────────────────────────────────────────────
function spKpis(items) {
  return `<div class="sp-kpi-row">${items.map(({ label, value, sub, color }) =>
    `<div class="sp-kpi-card glass" style="--kpi-color:${color || '#6366f1'}">
          <div class="sp-kpi-val">${value}</div>
          <div class="sp-kpi-label">${label}</div>
          ${sub ? `<div class="sp-kpi-sub">${sub}</div>` : ''}
        </div>`
  ).join('')}</div>`;
}

// ── Utility: funnel bar ───────────────────────────────────────────────────────
function spFunnelBar(stages) {
  const max = stages[0]?.events || 1;
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981'];
  return `<div class="sp-funnel">${stages.map((s, i) => {
    const pct = Math.round(Number(s.events) / max * 100);
    const dropPct = i > 0 ? Math.round((1 - Number(s.events) / Number(stages[i - 1].events)) * 100) : 0;
    return `<div class="sp-funnel-row">
          <div class="sp-funnel-label">${s.stage?.toUpperCase() || s.label}</div>
          <div class="sp-funnel-bar-wrap">
            <div class="sp-funnel-bar" style="width:${pct}%;background:${colors[i]}"></div>
          </div>
          <div class="sp-funnel-stat">
            <span class="sp-funnel-n">${Number(s.events || s.cnt).toLocaleString()}</span>
            ${dropPct > 0 ? `<span class="sp-funnel-drop">↓${dropPct}%</span>` : ''}
          </div>
        </div>`;
  }).join('')}</div>`;
}

// ── Utility: SQL snippet display ──────────────────────────────────────────────
function spSql(sql) {
  const keywords = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT BY|LIMIT|JOIN|ON|WITH|AS|AND|OR|NOT|IN|uniq|count|sum|avg|min|max|round|countIf|sumIf|uniqMerge|avgMerge|minMerge|countMerge|toDate|toStartOfHour|dateDiff|multiIf|greatest|FINAL|INTERVAL|DAY|HOUR|PARTITION BY|ENGINE|MergeTree|ReplacingMergeTree|AggregatingMergeTree|LowCardinality|Float64|UInt8|String|DateTime|dictGet|dictGetOrDefault|dictHas|CREATE|DICTIONARY|PRIMARY KEY|SOURCE|LAYOUT|FLAT|LIFETIME|DEFAULT|INSERT|INTO|TABLE|SYSTEM|async_insert|wait_for_async_insert)\b/g;
  const safe = sql.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colored = safe.replace(keywords, '<span class="sql-kw">$1</span>');
  return `<div class="sp-sql-wrap"><pre class="sp-sql">${colored}</pre></div>`;
}

// ── Scenario card template ────────────────────────────────────────────────────
function spCard(num, title, icon, tagline, engineBadge, engineColor, sqlSnippet, bodyId, total = 10) {
  return `
    <div class="sp-card glass" id="sp-card-${num}">
      <div class="sp-card-header">
        <div class="sp-card-icon">${icon}</div>
        <div class="sp-card-meta">
          <div class="sp-card-num">USE CASE ${num} of ${total}</div>
          <div class="sp-card-title">${title}</div>
          <div class="sp-card-tagline">${tagline}</div>
        </div>
        <div class="sp-card-engine" style="background:${engineColor}22;color:${engineColor};border-color:${engineColor}40">${engineBadge}</div>
      </div>
      <div class="sp-card-sql-toggle">
        <button class="sp-sql-btn" onclick="spToggleSql(${num})">🔍 Show SQL</button>
      </div>
      <div class="sp-sql-block" id="sp-sql-${num}" style="display:none">${sqlSnippet}</div>
      <div class="sp-card-body" id="${bodyId}">
        <div class="sp-idle">Click <strong>Run Query</strong> to load live data from ClickHouse →</div>
      </div>
      <div class="sp-card-footer">
        <button class="btn sp-run-btn" onclick="spRun${num}()">▶ Run Query</button>
      </div>
    </div>`;
}

function spToggleSql(num) {
  const el = document.getElementById(`sp-sql-${num}`);
  const btn = document.querySelector(`#sp-card-${num} .sp-sql-btn`);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '🔍 Show SQL' : '🔼 Hide SQL';
}

function spLoading(bodyId) {
  const el = document.getElementById(bodyId);
  if (el) el.innerHTML = '<div class="sp-loading"><div class="sp-spinner"></div>Querying ClickHouse…</div>';
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Price Intelligence & Trend Analysis
// ══════════════════════════════════════════════════════════════════════════════
async function spRun1() {
  spLoading('sp-body-1');
  const cat = document.getElementById('sp-cat-select')?.value || 'Electronics';
  try {
    const d = await (await fetch(`${SP_API}/shoppers/price-intelligence?category=${encodeURIComponent(cat)}`)).json();
    if (d.error) throw new Error(d.error);
    const el = document.getElementById('sp-body-1');
    const totalDrops = d.priceDrop.length;
    const maxDrop = d.priceDrop[0] ? `${d.priceDrop[0].pct_drop}%` : 'N/A';
    const vendors = d.vendorComparison.length;
    el.innerHTML = `
          ${spKpis([
      { label: 'Price Drops Found', value: totalDrops, sub: 'Items with >10% drop in 7d', color: '#10b981' },
      { label: 'Max Price Drop', value: maxDrop, sub: d.priceDrop[0]?.product_name?.slice(0, 18) || '', color: '#ef4444' },
      { label: 'Vendors Tracked', value: vendors, sub: `in ${cat}`, color: '#6366f1' },
      { label: 'Price Updates', value: d.priceTrend.reduce((s, r) => s + Number(r.updates), 0).toLocaleString(), sub: 'Last 7 days', color: '#f97316' },
    ])}
          <div class="sp-section-title">🔥 Top Price Drops — ${cat}</div>
          ${spTable(d.priceDrop, { limit: 8 })}
          <div class="sp-two-col">
            <div>
              <div class="sp-section-title">🏪 Vendor Price Comparison</div>
              ${spTable(d.vendorComparison, { limit: 10 })}
            </div>
            <div>
              <div class="sp-section-title">📈 Daily Price Trend</div>
              ${spTable(d.priceTrend)}
            </div>
          </div>`;
  } catch (e) {
    document.getElementById('sp-body-1').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Coupon & Deal Effectiveness
// ══════════════════════════════════════════════════════════════════════════════
async function spRun2() {
  spLoading('sp-body-2');
  try {
    const d = await (await fetch(`${SP_API}/shoppers/coupon-effectiveness`)).json();
    if (d.error) throw new Error(d.error);
    const seen = d.funnel.find(r => r.stage === 'seen');
    const conv = d.funnel.find(r => r.stage === 'converted');
    const overallConvPct = seen && conv ? ((Number(conv.unique_users) / Number(seen.unique_users)) * 100).toFixed(1) : '0';
    const totalSavings = conv ? `$${Number(conv.total_savings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0';
    const el = document.getElementById('sp-body-2');
    el.innerHTML = `
          ${spKpis([
      { label: 'Overall Conversion', value: `${overallConvPct}%`, sub: 'Seen → Converted', color: '#10b981' },
      { label: 'Total Savings Unlocked', value: totalSavings, sub: 'By converted users', color: '#f9c74f' },
      { label: 'Coupons Tracked', value: d.topCoupons.length, sub: 'Unique coupon codes', color: '#6366f1' },
      { label: 'Vendors Using Coupons', value: d.vendorFunnel.length, sub: 'Active campaigns', color: '#ec4899' },
    ])}
          <div class="sp-section-title">📊 Coupon Redemption Funnel</div>
          ${spFunnelBar(d.funnel)}
          <div class="sp-two-col">
            <div>
              <div class="sp-section-title">🏆 Top Performing Coupons</div>
              ${spTable(d.topCoupons, { limit: 8 })}
            </div>
            <div>
              <div class="sp-section-title">🏪 Funnel by Vendor</div>
              ${spTable(d.vendorFunnel)}
            </div>
          </div>`;
  } catch (e) {
    document.getElementById('sp-body-2').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Cashback & Rewards Attribution
// ══════════════════════════════════════════════════════════════════════════════
async function spRun3() {
  spLoading('sp-body-3');
  try {
    const d = await (await fetch(`${SP_API}/shoppers/cashback-attribution`)).json();
    if (d.error) throw new Error(d.error);
    const totalGmv = d.vendorRoi.reduce((s, r) => s + Number(r.total_gmv), 0);
    const totalCashback = d.vendorRoi.reduce((s, r) => s + Number(r.total_cashback_paid), 0);
    const totalAffiliate = d.vendorRoi.reduce((s, r) => s + Number(r.total_affiliate_earned), 0);
    const netMargin = totalAffiliate - totalCashback;
    const el = document.getElementById('sp-body-3');
    el.innerHTML = `
          ${spKpis([
      { label: 'Total GMV', value: `$${Math.round(totalGmv).toLocaleString()}`, sub: 'Gross Merchandise Value', color: '#6366f1' },
      { label: 'Cashback Paid Out', value: `$${Math.round(totalCashback).toLocaleString()}`, sub: '30 days', color: '#ef4444' },
      { label: 'Affiliate Revenue', value: `$${Math.round(totalAffiliate).toLocaleString()}`, sub: 'Earned from vendors', color: '#10b981' },
      { label: 'Net Margin', value: `$${Math.round(netMargin).toLocaleString()}`, sub: 'Affiliate − Cashback', color: netMargin > 0 ? '#10b981' : '#ef4444' },
    ])}
          <div class="sp-section-title">💰 Vendor ROI — Cashback Cost vs. Affiliate Revenue</div>
          ${spTable(d.vendorRoi)}
          <div class="sp-two-col">
            <div>
              <div class="sp-section-title">🏆 Top 10 Super Savers</div>
              ${spTable(d.topUsers, { limit: 10 })}
            </div>
            <div>
              <div class="sp-section-title">⚠️ Attribution Leakage by Vendor</div>
              ${spTable(d.leakage)}
              <div class="sp-insight">💡 Leakage = orders where cashback wasn't tracked. Indicates broken affiliate pixels or ad blockers.</div>
            </div>
          </div>`;
  } catch (e) {
    document.getElementById('sp-body-3').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. User Behavior & Personalization
// ══════════════════════════════════════════════════════════════════════════════
async function spRun4() {
  spLoading('sp-body-4');
  try {
    const d = await (await fetch(`${SP_API}/shoppers/user-behavior`)).json();
    if (d.error) throw new Error(d.error);
    const totalUsers = d.segments.reduce((s, r) => s + Number(r.unique_users), 0);
    const el = document.getElementById('sp-body-4');
    el.innerHTML = `
          ${spKpis([
      { label: 'Unique Shoppers', value: totalUsers.toLocaleString(), sub: 'Across all segments', color: '#6366f1' },
      { label: 'Buyer Segments', value: d.segments.length, sub: 'Distinct personas', color: '#8b5cf6' },
      { label: 'Best Segment', value: d.segments[0]?.user_segment || '—', sub: `${d.segments[0]?.conversion_pct}% conv.`, color: '#10b981' },
      { label: 'Page Types', value: d.dropOff.length, sub: 'Journey touchpoints', color: '#f97316' },
    ])}
          <div class="sp-section-title">👤 Shopper Segment Comparison</div>
          ${spTable(d.segments)}
          <div class="sp-two-col">
            <div>
              <div class="sp-section-title">🗺️ Cross-Vendor Journey by Segment</div>
              ${spTable(d.crossVendor)}
              <div class="sp-insight">💡 <code>LIMIT 3 BY user_segment</code> — top-N per group in a single scan pass, no window function overhead.</div>
            </div>
            <div>
              <div class="sp-section-title">📉 Page Drop-Off Funnel</div>
              ${spTable(d.dropOff)}
            </div>
          </div>
          <div class="sp-section-title">💲 Price Sensitivity by Segment (Top 3 Categories Each)</div>
          ${spTable(d.priceSensitivity)}`;
  } catch (e) {
    document.getElementById('sp-body-4').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Real-Time Vendor Feed Ingestion
// ══════════════════════════════════════════════════════════════════════════════
async function spRun5() {
  spLoading('sp-body-5');
  const sku = document.getElementById('sp-feed-sku')?.value || 'SKU00001';
  try {
    const d = await (await fetch(`${SP_API}/shoppers/vendor-feed-ingest?sku_id=${encodeURIComponent(sku)}`)).json();
    if (d.error) throw new Error(d.error);
    const s = d.feedStats;
    document.getElementById('sp-body-5').innerHTML = `
          ${spKpis([
      { label: 'Total Feed Rows', value: Number(s?.total_rows || 0).toLocaleString(), sub: 'Before dedup (FINAL)', color: '#6366f1' },
      { label: 'Vendors in Feed', value: Number(s?.vendors || 0).toLocaleString(), sub: 'Active data sources', color: '#8b5cf6' },
      { label: 'Unique SKUs', value: Number(s?.skus || 0).toLocaleString(), sub: 'Products tracked', color: '#10b981' },
      { label: 'SKU Queried', value: sku, sub: 'Cross-vendor snapshot', color: '#f97316' },
    ])}
          <div class="sp-section-title">📡 Price Snapshot for ${sku} — All Vendors (FINAL)</div>
          ${spTable(d.snapshot)}
          <div class="sp-insight">💡 <strong>ReplacingMergeTree(feed_version)</strong> — ClickHouse keeps the row with the highest <code>feed_version</code> per <code>(vendor_id, sku_id)</code>. <code>FINAL</code> forces synchronous dedup so you always see the latest price per vendor.</div>`;
  } catch (e) {
    document.getElementById('sp-body-5').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

async function spInsertFeed() {
  const vendor = document.getElementById('sp-feed-vendor')?.value || 'amzn';
  const sku = document.getElementById('sp-feed-sku')?.value || 'SKU00001';
  const price = document.getElementById('sp-feed-price')?.value || 99.99;
  const inStock = document.getElementById('sp-feed-stock')?.value || 1;
  const resultEl = document.getElementById('sp-feed-result');
  if (resultEl) resultEl.innerHTML = '<span style="color:var(--text3)">Inserting…</span>';
  try {
    const d = await (await fetch(`${SP_API}/shoppers/vendor-feed-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendor, sku_id: sku, price_usd: parseFloat(price), in_stock: parseInt(inStock) }),
    })).json();
    if (d.error) throw new Error(d.error);
    if (resultEl) resultEl.innerHTML = `
          <div class="sp-insert-result">
            ✅ Inserted! vendor=<strong>${vendor}</strong>, sku=<strong>${sku}</strong>, price=<strong>$${price}</strong>,
            feed_version=<strong>${d.inserted.feed_version}</strong><br>
            Rows before: <strong>${d.rowsBefore}</strong> → After: <strong>${d.rowsAfter}</strong>
            (ReplacingMergeTree deduplicates at merge time — run FINAL to see latest price)
          </div>`;
    spRun5(); // Refresh the snapshot
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--red)">⚠️ ${e.message}</span>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Product Catalog Intelligence
// ══════════════════════════════════════════════════════════════════════════════
async function spRun6() {
  spLoading('sp-body-6');
  try {
    const d = await (await fetch(`${SP_API}/shoppers/catalog-intelligence`)).json();
    if (d.error) throw new Error(d.error);
    const totalSkus = d.categoryStats.reduce((s, r) => s + Number(r.sku_count), 0);
    const totalReviews = d.brandShare.reduce((s, r) => s + Number(r.total_reviews), 0);
    const topBrand = d.brandShare[0];
    const el = document.getElementById('sp-body-6');
    el.innerHTML = `
          ${spKpis([
      { label: 'Total SKUs', value: totalSkus.toLocaleString(), sub: 'Active in catalog (FINAL)', color: '#6366f1' },
      { label: 'Total Reviews', value: totalReviews.toLocaleString(), sub: 'Across all products', color: '#8b5cf6' },
      { label: 'Top Brand', value: topBrand?.brand || '—', sub: `${Number(topBrand?.total_reviews || 0).toLocaleString()} reviews`, color: '#f9c74f' },
      { label: 'Categories', value: d.categoryStats.length, sub: 'Product categories', color: '#10b981' },
    ])}
          <div class="sp-two-col">
            <div>
              <div class="sp-section-title">🏆 Brand Market Share (by Reviews)</div>
              ${spTable(d.brandShare)}
            </div>
            <div>
              <div class="sp-section-title">📦 Category Depth & Pricing</div>
              ${spTable(d.categoryStats)}
            </div>
          </div>
          <div class="sp-two-col">
            <div>
              <div class="sp-section-title">⏱️ Data Freshness by Category</div>
              ${spTable(d.freshness)}
              <div class="sp-insight">💡 <strong>ReplacingMergeTree</strong> + <code>FINAL</code> ensures each SKU appears once — the latest catalog version wins.</div>
            </div>
            <div>
              <div class="sp-section-title">⭐ Top-Rated Product per Category (LIMIT 2 BY)</div>
              ${spTable(d.topRated)}
            </div>
          </div>`;
  } catch (e) {
    document.getElementById('sp-body-6').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Materialized Views for Live Dashboards
// ══════════════════════════════════════════════════════════════════════════════
async function spRun7() {
  spLoading('sp-body-7');
  const cat = document.getElementById('sp-mv-cat-select')?.value || 'Electronics';
  try {
    const d = await (await fetch(`${SP_API}/shoppers/live-dashboard?category=${encodeURIComponent(cat)}`)).json();
    if (d.error) throw new Error(d.error);
    const b = d.benchmark;
    const el = document.getElementById('sp-body-7');
    const maxMs = Math.max(b.rawQuery.ms, b.mvQuery.ms) || 1;
    el.innerHTML = `
          ${spKpis([
      { label: 'Raw Query', value: `${b.rawQuery.ms}ms`, sub: 'Full scan of sp_price_events', color: '#ef4444' },
      { label: 'MV Query', value: `${b.mvQuery.ms}ms`, sub: 'AggregatingMergeTree merge', color: '#10b981' },
      { label: 'Speedup', value: b.speedupMs > 0 ? `${b.speedupPct}% faster` : 'Similar', sub: `${b.speedupMs}ms saved`, color: '#f9c74f' },
      { label: 'Live KPIs', value: d.liveKpis.length, sub: `Vendors active in ${cat} today`, color: '#6366f1' },
    ])}
          <div class="sp-bench-compare">
            <div class="sp-bench-side ${b.rawQuery.ms <= b.mvQuery.ms ? 'sp-bench-winner' : ''}">
              <div class="sp-bench-label">🐢 Raw Scan</div>
              <div class="sp-bench-ms">${b.rawQuery.ms}ms</div>
              <div class="sp-bench-bar-wrap"><div class="sp-bench-bar" style="width:${(b.rawQuery.ms / maxMs * 100).toFixed(0)}%;background:#ef4444"></div></div>
              <div class="sp-bench-note">${b.rawQuery.sql}</div>
            </div>
            <div class="sp-bench-side ${b.mvQuery.ms <= b.rawQuery.ms ? 'sp-bench-winner' : ''}">
              <div class="sp-bench-label">⚡ Materialized View</div>
              <div class="sp-bench-ms">${b.mvQuery.ms}ms</div>
              <div class="sp-bench-bar-wrap"><div class="sp-bench-bar" style="width:${(b.mvQuery.ms / maxMs * 100).toFixed(0)}%;background:#10b981"></div></div>
              <div class="sp-bench-note">${b.mvQuery.sql}</div>
            </div>
          </div>
          <div class="sp-section-title">📊 Live KPIs — ${cat} Vendors (Last 24h from MV)</div>
          ${spTable(d.liveKpis)}
          <div class="sp-insight">💡 ${d.explanation}</div>`;
  } catch (e) {
    document.getElementById('sp-body-7').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. Async Inserts + Deduplication
// ══════════════════════════════════════════════════════════════════════════════
async function spRun8() {
  const bodyEl = document.getElementById('sp-body-8');
  if (bodyEl) bodyEl.innerHTML = '<div class="sp-loading"><div class="sp-spinner"></div>Firing async inserts… (this sends 2 identical batches to demo dedup)</div>';
  try {
    const batchId = `demo-${Date.now()}`;
    const d = await (await fetch(`${SP_API}/shoppers/async-inserts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId }),
    })).json();
    if (d.error) throw new Error(d.error);

    // Also fetch settings overview
    const info = await (await fetch(`${SP_API}/shoppers/async-inserts`)).json();

    bodyEl.innerHTML = `
      ${spKpis([
      { label: 'Rows Sent (×2)', value: (d.rowsSent * 2).toLocaleString(), sub: '2 identical batches', color: '#6366f1' },
      { label: 'Rows in DB', value: d.rowsInDb.toLocaleString(), sub: 'After dedup', color: d.dedupWorked ? '#10b981' : '#ef4444' },
      { label: 'Dedup Worked?', value: d.dedupWorked ? '✅ Yes' : '❌ No', sub: 'Second batch dropped', color: d.dedupWorked ? '#10b981' : '#ef4444' },
      { label: 'Insert Latency', value: `${d.insertMs}ms`, sub: 'fire-and-forget', color: '#f9c74f' },
    ])}
      <div class="sp-insight">💡 Batch ID: <code>${d.batchId}</code> — Both batches had the same ID. ClickHouse deduplicated the second, so only ${d.rowsInDb} rows landed instead of ${d.rowsSent * 2}.</div>
      <div class="sp-section-title">📋 Async Insert Log (system.async_insert_log)</div>
      ${d.log.length ? spTable(d.log) : '<div class="sp-empty">Log entries appear after ClickHouse flushes the buffer (usually within 200ms). Retry to see entries.</div>'}
      <div class="sp-section-title">⚙️ Key Settings</div>
      <table class="sp-tbl"><thead><tr><th>Setting</th><th>What it does</th></tr></thead><tbody>
        ${Object.entries(info.settings || {}).map(([k, v]) => `<tr><td class="sp-cell" style="font-family:var(--mono);color:#f9c74f">${k}</td><td class="sp-cell">${v}</td></tr>`).join('')}
      </tbody></table>
      ${d.explanation.map(e => `<div class="sp-insight" style="margin-top:6px">💡 ${e}</div>`).join('')}
    `;
  } catch (e) {
    document.getElementById('sp-body-8').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. Dictionaries
// ══════════════════════════════════════════════════════════════════════════════
async function spRun9() {
  spLoading('sp-body-9');
  try {
    const d = await (await fetch(`${SP_API}/shoppers/dictionaries`)).json();
    if (d.error) throw new Error(d.error);
    const el = document.getElementById('sp-body-9');
    const maxMs = Math.max(d.dictMs, d.joinMs) || 1;
    el.innerHTML = `
      ${spKpis([
      { label: 'dictGet() Time', value: `${d.dictMs}ms`, sub: 'In-memory O(1) lookup', color: '#10b981' },
      { label: 'JOIN Time', value: `${d.joinMs}ms`, sub: 'Hash table probe', color: '#ef4444' },
      { label: 'Speedup', value: d.speedupX ? `${d.speedupX}×` : '~same', sub: 'dict vs JOIN', color: '#f9c74f' },
      { label: 'Dict Entries', value: (d.meta[0]?.element_count || 30).toLocaleString(), sub: d.meta[0]?.memory_used || '', color: '#6366f1' },
    ])}
      <div class="sp-bench-compare">
        <div class="sp-bench-side ${d.dictMs <= d.joinMs ? 'sp-bench-winner' : ''}">
          <div class="sp-bench-label">⚡ dictGet() lookup</div>
          <div class="sp-bench-ms">${d.dictMs}ms</div>
          <div class="sp-bench-bar-wrap"><div class="sp-bench-bar" style="width:${(d.dictMs / maxMs * 100).toFixed(0)}%;background:#10b981"></div></div>
          <div class="sp-bench-note">In-memory flat array — no I/O, no hash build</div>
        </div>
        <div class="sp-bench-side ${d.joinMs <= d.dictMs ? 'sp-bench-winner' : ''}">
          <div class="sp-bench-label">🐢 INNER JOIN</div>
          <div class="sp-bench-ms">${d.joinMs}ms</div>
          <div class="sp-bench-bar-wrap"><div class="sp-bench-bar" style="width:${(d.joinMs / maxMs * 100).toFixed(0)}%;background:#ef4444"></div></div>
          <div class="sp-bench-note">Build hash table from right side, probe per row</div>
        </div>
      </div>
      <div class="sp-section-title">📖 Dictionary Metadata (system.dictionaries)</div>
      ${spTable(d.meta)}
      <div class="sp-section-title">🔍 dictGet() Enriched Price Data (vs JOIN — same result, faster)</div>
      ${spTable(d.dictRows, { limit: 10 })}
      <div class="sp-section-title">🛡️ dictGetOrDefault + dictHas — Safe Lookups</div>
      ${spTable([d.fallback])}
      <div class="sp-insight">💡 <code>dictGetOrDefault('demo.product_dict', 'brand', 'SKU_UNKNOWN', 'N/A')</code> returns <strong>'N/A'</strong> instead of throwing for unknown keys — critical for enriching event streams with gaps in catalog coverage.</div>
      ${d.explanation.map(e => `<div class="sp-insight" style="margin-top:6px">💡 ${e}</div>`).join('')}
    `;
  } catch (e) {
    document.getElementById('sp-body-9').innerHTML = `<div class="sp-error">⚠️ ${e.message}</div>`;
  }
}
// ══════════════════════════════════════════════════════════════════════════════
// 10. Personalization Feed — Browser Extension → MV → Real-Time Homepage Feed
// ══════════════════════════════════════════════════════════════════════════════
async function spRun10() {
  const userId = document.getElementById('sp-pf-user')?.value || 'user_001';
  spLoading('sp-body-10');
  try {
    const d = await (await fetch(`${SP_API}/shoppers/personalization-feed?user_id=${userId}`)).json();
    if (d.error) throw new Error(d.error);
    const el = document.getElementById('sp-body-10');
    const s = d.stats;
    const b = d.benchmark;
    const maxMs = Math.max(b.aggMs, b.rawMs) || 1;

    // Build user select options
    const opts = (d.users || []).map(u =>
      `<option value="${u}" ${u === d.userId ? 'selected' : ''}>${u}</option>`).join('');

    el.innerHTML = `
      <div class="sp-pf-controls">
        <label class="sp-pf-label">👤 User</label>
        <select id="sp-pf-user" onchange="spRun10()" class="sp-select" style="min-width:150px">${opts}</select>
        <button class="sp-run-btn" onclick="spSimulatePageViews()" id="sp-pf-sim-btn">⚡ Simulate 25 Extension Events</button>
        <span id="sp-pf-sim-status" style="font-size:11px;color:var(--text3)"></span>
      </div>

      ${spKpis([
      { label: 'Total Page Views', value: Number(s?.total_events || 0).toLocaleString(), sub: 'This user · last 7 days', color: '#6366f1' },
      { label: 'Domains Visited', value: s?.domains_visited || 0, sub: 'Unique shopping sites', color: '#10b981' },
      { label: 'Categories Browsed', value: s?.categories || 0, sub: 'Product categories', color: '#f97316' },
      { label: 'AggMT Feed Query', value: `${b.aggMs}ms`, sub: `vs ${b.rawMs}ms raw scan`, color: '#f9c74f' },
    ])}

      <div class="sp-section-title">🏠 Homepage Feed — Ranked by Recency-Weighted Engagement</div>
      <div class="sp-insight">💡 <strong>No cron needed.</strong> The Materialized View fires on every INSERT. The AggMT stores running <code>countState</code>/<code>sumState</code>/<code>maxState</code> — <code>countMerge()</code>/<code>sumMerge()</code> finalize them at query time in sub-milliseconds.</div>

      <div class="sp-pf-feed">
        ${(d.feed || []).map((row, i) => `
          <div class="sp-pf-card">
            <div class="sp-pf-rank">${i + 1}</div>
            <div class="sp-pf-info">
              <div class="sp-pf-domain">${row.domain}</div>
              <div class="sp-pf-cat">${row.category}</div>
            </div>
            <div class="sp-pf-stats">
              <span class="sp-pf-stat">👁️ ${Number(row.views).toLocaleString()} views</span>
              <span class="sp-pf-stat">⏱ ${row.avg_dwell_sec}s avg dwell</span>
              <span class="sp-pf-stat">📦 ${row.unique_products} products</span>
              <span class="sp-pf-stat">🕐 ${row.last_seen}</span>
            </div>
            <div class="sp-pf-score">⭐ ${row.relevance_score}</div>
          </div>`).join('')}
      </div>

      <!-- ── How This Is Handled: PostgreSQL vs ClickHouse ─────────────────── -->
      <div class="sp-section-title">📚 Learning: PostgreSQL vs ClickHouse — Same Problem, Different Approach</div>

      <!-- Problem Statement -->
      <div class="sp-pf-scenario-block sp-pf-problem">
        <div class="sp-pf-scenario-label">🎯 The Problem</div>
        <p class="sp-pf-scenario-desc">
          A browser extension fires a page-view event every time a user browses a shopping site.
          When that user lands on your homepage, you want to show them a ranked feed of the most
          relevant domains and categories — <strong>based on their most recent activity</strong>.
          The feed must be fresh. A stale feed shows the wrong things.
        </p>
        <div class="sp-pf-flow-box">
          <span class="sp-pf-flow-node sp-pf-flow-src">🖥️ Browser Extension<br><small>fires events live</small></span>
          <span class="sp-pf-flow-arrow">→</span>
          <span class="sp-pf-flow-node sp-pf-flow-store">📦 Event Store<br><small>page_views table</small></span>
          <span class="sp-pf-flow-arrow">→</span>
          <span class="sp-pf-flow-node sp-pf-flow-agg">⚙️ Aggregation<br><small>???</small></span>
          <span class="sp-pf-flow-arrow">→</span>
          <span class="sp-pf-flow-node sp-pf-flow-feed">🏠 Homepage Feed<br><small>ranked results</small></span>
        </div>
      </div>

      <div class="sp-pf-compare-wrap">

        <!-- PostgreSQL Side -->
        <div class="sp-pf-compare-side sp-pf-pg">
          <div class="sp-pf-compare-header">
            <span class="sp-pf-compare-badge">🐘 PostgreSQL</span>
            <span class="sp-pf-compare-sub">Traditional approach</span>
          </div>

          <div class="sp-pf-compare-section">How aggregation works</div>
          <div class="sp-anim-pipeline sp-anim-pg">
            <div class="sp-anim-step" style="--d:0s">🖥️ Extension fires event</div>
            <div class="sp-anim-arrow sp-anim-arrow-bad">↓ <small>lands in raw table</small></div>
            <div class="sp-anim-step" style="--d:.15s">📦 page_views (50k+ rows)</div>
            <div class="sp-anim-arrow sp-anim-arrow-bad">↓ <small>⏳ wait for cron…</small></div>
            <div class="sp-anim-step sp-anim-cron" style="--d:.3s">⏰ Cron fires (every 5 min)<br><small>Full table scan + UPSERT</small></div>
            <div class="sp-anim-arrow sp-anim-arrow-bad">↓ <small>stale result written</small></div>
            <div class="sp-anim-step" style="--d:.45s">👤 user_profile (summary)</div>
            <div class="sp-anim-arrow">↓</div>
            <div class="sp-anim-step sp-anim-feed-bad" style="--d:.6s">🏠 Homepage feed<br><small style="color:#ef4444">Up to 5 min stale</small></div>
          </div>

          <div class="sp-pf-compare-section">The code you'd write</div>
          <pre class="sp-pf-code">-- 1. Raw events table
CREATE TABLE page_views (
  user_id TEXT, domain TEXT,
  category TEXT, dwell_ms INT,
  viewed_at TIMESTAMPTZ
);

-- 2. Summary table (manually managed)
CREATE TABLE user_profile (
  user_id TEXT, domain TEXT,
  category TEXT, view_count INT,
  total_dwell_ms BIGINT,
  last_seen TIMESTAMPTZ,
  PRIMARY KEY (user_id, domain, category)
);

-- 3. Cron job (runs every 5 min via pg_cron)
SELECT cron.schedule('*/5 * * * *', $$
  INSERT INTO user_profile
    (user_id, domain, category, view_count,
     total_dwell_ms, last_seen)
  SELECT user_id, domain, category,
    COUNT(*), SUM(dwell_ms), MAX(viewed_at)
  FROM page_views
  WHERE viewed_at > now() - INTERVAL '7 days'
  GROUP BY user_id, domain, category
  ON CONFLICT (user_id, domain, category)
  DO UPDATE SET
    view_count    = user_profile.view_count
                  + EXCLUDED.view_count,
    total_dwell_ms= user_profile.total_dwell_ms
                  + EXCLUDED.total_dwell_ms,
    last_seen     = GREATEST(user_profile.last_seen,
                             EXCLUDED.last_seen);
$$);</pre>

          <div class="sp-pf-compare-section">Limitations</div>
          <ul class="sp-pf-limits">
            <li>Feed is always 0–5 min stale — cron interval is the floor</li>
            <li>Full table scan per cron run (grows with data volume)</li>
            <li>UPSERT logic is fragile — race conditions at high insert rates</li>
            <li>Adding a new dimension (hour-of-day) means rewriting the cron and backfilling</li>
            <li>If the cron misses a run, catch-up logic needed</li>
            <li>Separate infrastructure: pg_cron, worker process, or external scheduler</li>
          </ul>
        </div>

        <!-- ClickHouse Side -->
        <div class="sp-pf-compare-side sp-pf-ch">
          <div class="sp-pf-compare-header">
            <span class="sp-pf-compare-badge sp-pf-ch-badge">⚡ ClickHouse</span>
            <span class="sp-pf-compare-sub">This demo</span>
          </div>

          <div class="sp-pf-compare-section">How aggregation works</div>
          <div class="sp-anim-pipeline sp-anim-ch">
            <div class="sp-anim-step sp-anim-step-ch" style="--d:0s">🖥️ Extension fires event</div>
            <div class="sp-anim-arrow sp-anim-arrow-good">↓ <small>async INSERT (fire-and-forget)</small></div>
            <div class="sp-anim-step sp-anim-step-ch" style="--d:.15s">📦 page_views (raw events)</div>
            <div class="sp-anim-arrow sp-anim-arrow-good">↓ <small>⚡ MV trigger fires instantly on new rows</small></div>
            <div class="sp-anim-step sp-anim-step-ch sp-anim-mv" style="--d:.3s">🧠 MV writes partial states<br><small>countState · sumState · maxState</small></div>
            <div class="sp-anim-arrow sp-anim-arrow-good">↓ <small>append-only, no conflict</small></div>
            <div class="sp-anim-step sp-anim-step-ch" style="--d:.45s">📊 pv_user_profile (AggMT)</div>
            <div class="sp-anim-arrow sp-anim-arrow-good">↓ <small>countMerge() finalises at query time</small></div>
            <div class="sp-anim-step sp-anim-step-ch sp-anim-feed-good" style="--d:.6s">🏠 Homepage feed<br><small style="color:#10b981">Always current — zero lag</small></div>
          </div>

          <div class="sp-pf-compare-section">The code you'd write</div>
          <pre class="sp-pf-code">-- 1. Raw events table (identical concept)
CREATE TABLE page_views (
  user_id String, domain String,
  category LowCardinality(String),
  dwell_ms UInt32, viewed_at DateTime
) ENGINE = MergeTree()
ORDER BY (user_id, domain, viewed_at);

-- 2. Pre-aggregation target (AggMT)
CREATE TABLE pv_user_profile (
  user_id String, domain String,
  category LowCardinality(String),
  -- Partial states, not final numbers
  view_count     AggregateFunction(count, UInt8),
  total_dwell_ms AggregateFunction(sum,   UInt32),
  last_seen      AggregateFunction(max,   DateTime)
) ENGINE = AggregatingMergeTree()
ORDER BY (user_id, domain, category);

-- 3. Materialized View — written ONCE, runs forever
-- No cron. No scheduler. Fires on every INSERT.
CREATE MATERIALIZED VIEW pv_mv
TO pv_user_profile AS
SELECT user_id, domain, category,
  countState()        AS view_count,
  sumState(dwell_ms)  AS total_dwell_ms,
  maxState(viewed_at) AS last_seen
FROM page_views
GROUP BY user_id, domain, category;

-- 4. Homepage query — reads AggMT, not raw rows
SELECT domain, category,
  countMerge(view_count)       AS views,
  maxMerge(last_seen)          AS last_seen
FROM pv_user_profile
WHERE user_id = 'user_001'
GROUP BY domain, category
ORDER BY views DESC LIMIT 10;</pre>

          <div class="sp-pf-compare-section">Why it works better</div>
          <ul class="sp-pf-limits sp-pf-wins">
            <li>Feed updates the moment an INSERT lands — zero scheduled delay</li>
            <li>MV only processes new rows (delta), not the full table</li>
            <li>Partial states are append-only — no UPSERT, no lock contention</li>
            <li>New dimension? Add a column to the MV and query immediately</li>
            <li>MV is self-healing — if ClickHouse restarts, it catches up automatically</li>
            <li>No separate infrastructure — MV is a first-class ClickHouse object</li>
          </ul>
        </div>
      </div>

      <!-- Side-by-side table -->
      <div class="sp-section-title" style="margin-top:16px">📊 At a Glance</div>
      <table class="sp-tbl">
        <thead><tr><th>Dimension</th><th>🐘 PostgreSQL + cron</th><th>⚡ ClickHouse MV + AggMT</th></tr></thead>
        <tbody>
          ${[
        ['Feed freshness', 'Up to 5 min stale', 'Instant — updates on each INSERT'],
        ['Aggregation cost', 'Full table scan per cron run', 'Delta only — new rows processed once'],
        ['Write pattern', 'UPSERT (conflict resolution needed)', 'Append partial state (no conflicts)'],
        ['Scale ceiling', 'Cron takes longer as data grows', 'AggMT row count stays flat — stays fast'],
        ['Flexibility', 'New dimension = rewrite + backfill', 'New column in MV, query immediately'],
        ['Infrastructure', 'pg_cron / external scheduler required', 'Built into ClickHouse, zero extra setup'],
        ['Data model', 'Final numbers stored', 'Partial states — merged at query time'],
      ].map(([dim, pg, ch]) => `
            <tr>
              <td class="sp-cell" style="font-weight:600;color:var(--text2)">${dim}</td>
              <td class="sp-cell" style="color:#ef4444">${pg}</td>
              <td class="sp-cell" style="color:#10b981">${ch}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="sp-insight" style="margin-top:8px">💡 <strong>Try it:</strong> click <em>⚡ Simulate 25 Extension Events</em> above — watch the feed update in under a second. No cron fired. The MV triggered on that one INSERT and the AggMT updated immediately.</div>

      <div class="sp-section-title">⚡ Benchmark: AggMT vs Raw Table Scan</div>
      <div class="sp-bench-compare">
        <div class="sp-bench-side ${b.aggMs <= b.rawMs ? 'sp-bench-winner' : ''}">
          <div class="sp-bench-label">⚡ AggregatingMergeTree (MV)</div>
          <div class="sp-bench-ms">${b.aggMs}ms</div>
          <div class="sp-bench-bar-wrap"><div class="sp-bench-bar" style="width:${(b.aggMs / maxMs * 100).toFixed(0)}%;background:#10b981"></div></div>
          <div class="sp-bench-note">Reads compressed partial states, merges in flight — no raw row scan</div>
        </div>
        <div class="sp-bench-side ${b.rawMs <= b.aggMs ? 'sp-bench-winner' : ''}">
          <div class="sp-bench-label">🐢 Raw page_views (GROUP BY)</div>
          <div class="sp-bench-ms">${b.rawMs}ms</div>
          <div class="sp-bench-bar-wrap"><div class="sp-bench-bar" style="width:${(b.rawMs / maxMs * 100).toFixed(0)}%;background:#ef4444"></div></div>
          <div class="sp-bench-note">Full scan of all 50k rows for this user, then aggregate</div>
        </div>
      </div>
    `;


    // Update the user select reference
    document.getElementById('sp-pf-user')?.addEventListener('change', spRun10);
  } catch (e) {
    document.getElementById('sp-body-10').innerHTML = `< div class="sp-error" >⚠️ ${e.message}</div > `;
  }
}

async function spSimulatePageViews() {
  const userId = document.getElementById('sp-pf-user')?.value || 'user_001';
  const btn = document.getElementById('sp-pf-sim-btn');
  const status = document.getElementById('sp-pf-sim-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Inserting…'; }
  try {
    const d = await (await fetch(`${SP_API}/shoppers/simulate-pageview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, count: 25 }),
    })).json();
    if (d.error) throw new Error(d.error);
    if (status) status.textContent = `✅ ${d.inserted} events fired via async insert in ${d.ms}ms — feed updating…`;
    setTimeout(spRun10, 600);
  } catch (e) {
    if (status) status.textContent = `⚠️ ${e.message}`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Simulate 25 Extension Events'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Downstream dependency graph ───────────────────────────────────────────────
const SPF_GRAPH = {
  'fn-src-vf': ['fn-pe', 'fn-vf', 'fn-af'],
  'fn-src-se': ['fn-us'],
  'fn-src-co': ['fn-ce'],
  'fn-src-cb': ['fn-cb'],
  'fn-pe': ['fn-agg', 'fn-uc1'],
  'fn-ce': ['fn-uc2'],
  'fn-cb': ['fn-uc3'],
  'fn-us': ['fn-uc4'],
  'fn-vf': ['fn-uc5'],
  'fn-pc': ['fn-dict', 'fn-uc6'],
  'fn-af': ['fn-uc8'],
  'fn-agg': ['fn-uc7'],
  'fn-dict': ['fn-uc9'],
};

// BFS to get all descendants of a node
function spDescendants(nodeId) {
  const visited = new Set(), q = [...(SPF_GRAPH[nodeId] || [])];
  while (q.length) { const n = q.shift(); if (!visited.has(n)) { visited.add(n); (SPF_GRAPH[n] || []).forEach(x => q.push(x)); } }
  return visited;
}

let _spfActive = null; // currently highlighted node id

// Highlight clicked node + all descendants; dim everything else
function spHighlight(nodeId) {
  if (_spfActive === nodeId) { spHighlightReset(); return; }
  _spfActive = nodeId;
  const desc = spDescendants(nodeId);
  const relevant = new Set([nodeId, ...desc]);

  // nodes
  document.querySelectorAll('#spf-diagram .spf-node').forEach(el => {
    const id = el.dataset.node;
    if (relevant.has(id)) {
      el.classList.add('spf-active-node');
      el.classList.remove('spf-dim-node');
    } else {
      el.classList.remove('spf-active-node');
      el.classList.add('spf-dim-node');
    }
  });

  // SVG paths
  document.querySelectorAll('#spf-svg path[data-from]').forEach(path => {
    const from = path.dataset.from, to = path.dataset.to;
    const active = relevant.has(from) && relevant.has(to);
    path.style.opacity = active ? '1' : '0.08';
    path.style.strokeWidth = active ? '3.5' : '1';
    if (active) path.style.filter = 'drop-shadow(0 0 4px currentColor)';
    else path.style.filter = '';
  });
}

function spHighlightReset() {
  _spfActive = null;
  document.querySelectorAll('#spf-diagram .spf-node').forEach(el => {
    el.classList.remove('spf-active-node', 'spf-dim-node');
  });
  document.querySelectorAll('#spf-svg path[data-from]').forEach(path => {
    path.style.opacity = '1';
    path.style.strokeWidth = '';
    path.style.filter = '';
  });
}

function spDrawFlowLines() {
  const svg = document.getElementById('spf-svg');
  const wrap = document.getElementById('spf-diagram');
  if (!svg || !wrap) return;

  const wBox = wrap.getBoundingClientRect();
  svg.setAttribute('width', wBox.width);
  svg.setAttribute('height', wBox.height);
  svg.setAttribute('viewBox', `0 0 ${wBox.width} ${wBox.height} `);

  // right-center exit of a node
  const rMid = id => {
    const el = document.getElementById(id); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.right - wBox.left, y: r.top + r.height / 2 - wBox.top };
  };
  // left-center entry of a node
  const lMid = id => {
    const el = document.getElementById(id); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - wBox.left, y: r.top + r.height / 2 - wBox.top };
  };

  // Cubic Bézier with horizontal handles — returns an SVG <path> string
  const bez = (fromId, toId, opts = {}) => {
    const a = rMid(fromId), b = lMid(toId);
    if (!a || !b) return '';
    const cx = (a.x + b.x) / 2;
    const col = opts.color || '#6366f1';
    const w = opts.width || 2.5;
    const dash = opts.dashed ? `stroke - dasharray="${opts.dashed}"` : '';
    const mid = opts.marker !== false ? `marker - end="url(#fmk-${col.replace('#', '')}"` : '';
    return `< path d = "M${a.x},${a.y} C${cx},${a.y} ${cx},${b.y} ${b.x},${b.y}"
    stroke = "${col}" stroke - width="${w}" fill = "none" stroke - linecap="round"
      ${dash} marker - end="url(#fmk-${col.replace('#', '')})"
    data - from="${fromId}" data - to="${toId}" style = "transition:opacity .25s,stroke-width .25s" /> `;
  };

  // defs with larger arrowheads
  const defs = `< defs >
      ${['6366f1', 'f97316', '8b5cf6', 'f9c74f', 'ec4899', '10b981'].map(c => `
    <marker id="fmk-${c}" markerWidth="9" markerHeight="9" refX="5" refY="4.5" orient="auto">
      <path d="M0,0 L0,9 L9,4.5 z" fill="#${c}"/>
    </marker>`).join('')
    }
  </defs > `;

  const paths = [
    // Sources → Tables (solid, indigo/orange/purple)
    bez('fn-src-vf', 'fn-pe', { color: '#6366f1' }),
    bez('fn-src-se', 'fn-us', { color: '#6366f1' }),
    bez('fn-src-co', 'fn-ce', { color: '#6366f1' }),
    bez('fn-src-cb', 'fn-cb', { color: '#6366f1' }),
    bez('fn-src-vf', 'fn-vf', { color: '#f97316' }),
    bez('fn-src-vf', 'fn-af', { color: '#8b5cf6', dashed: '6 3' }),

    // Table → Pre-Agg (thick yellow MV / pink dashed dict)
    bez('fn-pe', 'fn-agg', { color: '#f9c74f', width: 3.5 }),
    bez('fn-pc', 'fn-dict', { color: '#ec4899', width: 2.5, dashed: '6 3' }),

    // Tables/Pre-Agg → Use Cases
    bez('fn-pe', 'fn-uc1', { color: '#10b981' }),
    bez('fn-ce', 'fn-uc2', { color: '#10b981' }),
    bez('fn-cb', 'fn-uc3', { color: '#10b981' }),
    bez('fn-us', 'fn-uc4', { color: '#10b981' }),
    bez('fn-vf', 'fn-uc5', { color: '#f97316' }),
    bez('fn-pc', 'fn-uc6', { color: '#f97316' }),
    bez('fn-agg', 'fn-uc7', { color: '#f9c74f' }),
    bez('fn-af', 'fn-uc8', { color: '#8b5cf6' }),
    bez('fn-dict', 'fn-uc9', { color: '#ec4899' }),
  ].join('\n');

  svg.innerHTML = defs + paths;

  // Attach click handlers to all nodes
  document.querySelectorAll('#spf-diagram .spf-node').forEach(el => {
    el.style.cursor = 'pointer';
    el.onclick = () => spHighlight(el.dataset.node);
  });
}


async function initShoppers() {
  const el = document.getElementById('shoppers-root');
  if (!el || el.dataset.init) return;
  el.dataset.init = '1';

  // Check seed status
  let seedRows = [];
  try {
    const s = await (await fetch(`${SP_API} /shoppers/seed - status`)).json();
    seedRows = Array.isArray(s) ? s : [];
  } catch (e) { /* offline */ }

  const seeded = seedRows.some(r => Number(r.rows?.replace(/[^0-9.]/g, '')) > 0);
  const seedBanner = seeded
    ? `< div class="sp-seed-ok" >✅ Shoppers Paradise data loaded — ${seedRows.map(r => `<strong>${r.tbl}</strong> (${r.rows})`).join(', ')}</div > `
    : `< div class="sp-seed-warn" >⚠️ Tables not seeded yet.Run: <code>docker exec clickhouse-backend node seed.js</code> or restart the stack.Then refresh.</div > `;

  const categories = ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Beauty', 'Toys', 'Grocery', 'Automotive'];
  const catOptions = categories.map(c => `< option value = "${c}" > ${c}</option > `).join('');

  el.innerHTML = `
      < !--Hero Header-- >
      <div class="sp-hero">
        <div class="sp-hero-badge">🛍️ Real-World Scenario</div>
        <h2 class="sp-hero-title">Shoppers Paradise</h2>
        <p class="sp-hero-desc">
          This scenario simulates the analytics backend of a multi-vendor shopping platform — the kind that aggregates prices, deals, and cashback offers from dozens of retailers in real time.
          The goal is to show <strong>exactly which ClickHouse features solve each real problem</strong>: tracking price drops across 10 vendors, measuring which coupons actually convert,
          attributing affiliate revenue without losing commissions to pixel leakage, understanding how different shopper types browse and buy, ingesting live vendor feeds without expensive
          database mutations, keeping a product catalog fresh, powering live dashboards that never re-scan raw data, and building real-time personalization feeds without crons.
          All 10 use cases run against 195k+ live rows — with the real SQL shown for each one.
        </p>
        ${seedBanner}
      </div>

      <!--Flow Diagram: 4 - col with JS - overlay SVG + click - to - highlight-- >
      <div class="spf-wrap glass">
        <div class="spf-header">
          <div class="spf-title">🗺️ Data Flow — From Source to Insight</div>
          <div class="spf-hint">Click any node to trace its downstream data path &nbsp;·&nbsp; Click again to reset</div>
        </div>

        <div class="spf-diagram" id="spf-diagram">
          <!-- Overlay SVG drawn by spDrawFlowLines() -->
          <svg id="spf-svg" class="spf-svg-overlay"></svg>

          <!-- Col 1: Sources -->
          <div class="spf-col">
            <div class="spf-col-lbl">Data Sources</div>
            <div class="spf-node spf-src" id="fn-src-vf" data-node="fn-src-vf">🏪 Vendor Feeds<br><small>10 vendors · price + stock</small></div>
            <div class="spf-node spf-src" id="fn-src-se" data-node="fn-src-se">👤 Shopper Sessions<br><small>browse · cart · checkout</small></div>
            <div class="spf-node spf-src" id="fn-src-co" data-node="fn-src-co">🎟️ Coupon Events<br><small>seen → clicked → converted</small></div>
            <div class="spf-node spf-src" id="fn-src-cb" data-node="fn-src-cb">💸 Affiliate Pixels<br><small>cashback + attribution</small></div>
          </div>

          <!-- Col 2: ClickHouse Tables -->
          <div class="spf-col">
            <div class="spf-col-lbl">ClickHouse Tables</div>
            <div class="spf-node spf-merge" id="fn-pe" data-node="fn-pe">sp_price_events<br><small>MergeTree · 60k rows</small></div>
            <div class="spf-node spf-merge" id="fn-ce" data-node="fn-ce">sp_coupon_events<br><small>MergeTree · 43k rows</small></div>
            <div class="spf-node spf-merge" id="fn-cb" data-node="fn-cb">sp_cashback_events<br><small>MergeTree · 20k rows</small></div>
            <div class="spf-node spf-merge" id="fn-us" data-node="fn-us">sp_user_sessions<br><small>MergeTree · 40k rows</small></div>
            <div class="spf-node spf-rmt" id="fn-vf" data-node="fn-vf">sp_vendor_feed<br><small>ReplacingMT · 300</small></div>
            <div class="spf-node spf-rmt" id="fn-pc" data-node="fn-pc">sp_product_catalog<br><small>ReplacingMT · 30</small></div>
            <div class="spf-node spf-async" id="fn-af" data-node="fn-af">sp_async_feed_demo<br><small>ReplacingMT (async)</small></div>
            <div class="spf-node spf-merge" id="fn-pv" data-node="fn-pv" style="border-color:rgba(168,85,247,.5)">page_views<br><small>MergeTree · 50k rows</small></div>
          </div>

          <!-- Col 3: Pre-Aggregation -->
          <div class="spf-col">
            <div class="spf-col-lbl">Pre-Aggregation</div>
            <div class="spf-node spf-agg" id="fn-agg" data-node="fn-agg">sp_price_hourly_agg<br><small>AggregatingMergeTree</small><br><small style="opacity:.7">countState · avgState · uniqState</small></div>
            <div class="spf-node spf-dict" id="fn-dict" data-node="fn-dict">product_dict<br><small>HASHED Dictionary</small><br><small style="opacity:.7">sku_id → brand · rating</small></div>
            <div class="spf-node spf-agg" id="fn-pvp" data-node="fn-pvp" style="border-color:rgba(168,85,247,.5)">pv_user_profile<br><small>AggregatingMergeTree</small><br><small style="opacity:.7">page_views → pv_mv → AggMT</small></div>
          </div>

              <!-- Col 4: Use Cases -->
              <div class="spf-col">
                <div class="spf-col-lbl">10 Use Cases</div>
                <div class="spf-node spf-uc spf-uc-merge" id="fn-uc1" data-node="fn-uc1">💰 Price Intelligence<br><small>PARTITION + HAVING</small></div>
                <div class="spf-node spf-uc spf-uc-merge" id="fn-uc2" data-node="fn-uc2">🎟️ Coupon Funnel<br><small>countIf() single pass</small></div>
                <div class="spf-node spf-uc spf-uc-merge" id="fn-uc3" data-node="fn-uc3">💸 Cashback ROI<br><small>columnar aggregation</small></div>
                <div class="spf-node spf-uc spf-uc-merge" id="fn-uc4" data-node="fn-uc4">👤 User Behavior<br><small>LIMIT N BY segment</small></div>
                <div class="spf-node spf-uc spf-uc-rmt" id="fn-uc5" data-node="fn-uc5">📡 Vendor Feed<br><small>ReplacingMT + FINAL</small></div>
                <div class="spf-node spf-uc spf-uc-rmt" id="fn-uc6" data-node="fn-uc6">📦 Catalog Intelligence<br><small>freshness scoring</small></div>
                <div class="spf-node spf-uc spf-uc-agg" id="fn-uc7" data-node="fn-uc7">⚡ Live Dashboards<br><small>AggMT *Merge()</small></div>
                <div class="spf-node spf-uc spf-uc-async" id="fn-uc8" data-node="fn-uc8">🚀 Async Inserts<br><small>buffer + dedup</small></div>
                <div class="spf-node spf-uc spf-uc-dict" id="fn-uc9" data-node="fn-uc9">📖 Dictionaries<br><small>dictGet() vs JOIN</small></div>
                <div class="spf-node spf-uc" id="fn-uc10" data-node="fn-uc10" style="border-color:rgba(168,85,247,.5);background:rgba(168,85,247,.08)">🧠 Personalization Feed<br><small>MV + AggMT real-time</small></div>
              </div>
            </div>

            <!-- Legend -->
            <div class="spf-legend">
              <span class="spf-pill spf-merge">MergeTree</span>
              <span class="spf-pill spf-rmt">ReplacingMergeTree</span>
              <span class="spf-pill spf-agg">AggregatingMergeTree</span>
              <span class="spf-pill spf-dict">Dictionary</span>
              <span class="spf-pill spf-async">Async Insert</span>
              <span class="spf-pill" style="background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.15);color:var(--text3)">── solid = INSERT &nbsp;·&nbsp; - - dashed = MV/Dict</span>
            </div>
          </div>


          <!-- Use Case Nav -->
          <div class="sp-nav">
            ${[
      ['💰', 'Price Intelligence'],
      ['🎟️', 'Coupon Effectiveness'],
      ['💸', 'Cashback Attribution'],
      ['👤', 'User Behavior'],
      ['📡', 'Vendor Feed'],
      ['📦', 'Catalog Intelligence'],
      ['⚡', 'Live Dashboards'],
      ['🚀', 'Async Inserts'],
      ['📖', 'Dictionaries'],
      ['🧠', 'Personalization Feed'],
    ].map(([icon, label], i) => `
          <button class="sp-nav-btn" onclick="document.getElementById('sp-card-${i + 1}').scrollIntoView({behavior:'smooth',block:'start'})">
            <span class="sp-nav-icon">${icon}</span><span>${label}</span>
          </button>`).join('')}
          </div>

          <!-- USE CASE 1: Price Intelligence -->
          ${spCard(1,
      'Price Intelligence & Trend Analysis', '💰',
      'Detect price drops, compare vendors, track pricing trends across 10 vendors in real-time',
      'MergeTree + PARTITION BY', '#6366f1',
      spSql(`SELECT
  sku_id, product_name, vendor_name,
  min(price_usd)  AS low_price,
  max(price_usd)  AS high_price,
  round((max(price_usd) - min(price_usd)) / max(price_usd) * 100, 1) AS pct_drop,
  count()         AS price_updates
FROM demo.sp_price_events
WHERE event_ts >= now() - INTERVAL 7 DAY
  AND category = 'Electronics'
GROUP BY sku_id, product_name, vendor_name
HAVING pct_drop > 10
ORDER BY pct_drop DESC
LIMIT 10`),
      'sp-body-1'
    )}
          <div class="sp-controls glass" style="margin-bottom:8px">
            <label class="sp-ctrl-label">Category:</label>
            <select id="sp-cat-select" class="sp-select">${catOptions}</select>
            <button class="btn" onclick="spRun1()" style="margin-left:8px">Apply</button>
          </div>

          <!-- USE CASE 2: Coupon Effectiveness -->
          ${spCard(2,
      'Coupon & Deal Effectiveness', '🎟️',
      'Track the full coupon funnel: seen → clicked → applied → converted. Find which coupons actually work.',
      'MergeTree + countIf()', '#8b5cf6',
      spSql(`SELECT
  coupon_code, discount_pct,
  countIf(stage='seen')       AS seen,
  countIf(stage='clicked')    AS clicked,
  countIf(stage='applied')    AS applied,
  countIf(stage='converted')  AS converted,
  round(countIf(stage='converted') /
    greatest(countIf(stage='seen'),1)*100, 1) AS conversion_pct,
  round(sum(savings_usd), 2)  AS total_savings_usd
FROM demo.sp_coupon_events
WHERE event_ts >= now() - INTERVAL 30 DAY
GROUP BY coupon_code, discount_pct
ORDER BY converted DESC`),
      'sp-body-2'
    )}

          <!-- USE CASE 3: Cashback Attribution -->
          ${spCard(3,
      'Cashback & Rewards Attribution', '💸',
      'Track affiliate ROI: how much cashback was paid vs. affiliate revenue earned. Detect leakage.',
      'MergeTree + JOIN patterns', '#ec4899',
      spSql(`SELECT
  vendor_name,
  count()                              AS orders,
  round(sum(order_usd), 2)             AS total_gmv,
  round(sum(cashback_usd), 2)          AS cashback_paid,
  round(sum(affiliate_revenue_usd), 2) AS affiliate_earned,
  round(sum(affiliate_revenue_usd) -
        sum(cashback_usd), 2)          AS net_margin,
  countIf(attributed=0)                AS leakage_count
FROM demo.sp_cashback_events
WHERE event_ts >= now() - INTERVAL 30 DAY
GROUP BY vendor_name
ORDER BY total_gmv DESC`),
      'sp-body-3'
    )}

          <!-- USE CASE 4: User Behavior -->
          ${spCard(4,
      'User Behavior & Personalization', '👤',
      'Understand your 4 shopper personas. Cross-vendor journeys, price sensitivity, conversion by segment.',
      'MergeTree + LIMIT N BY', '#f97316',
      spSql(`-- Top 3 categories per shopper segment (single-pass, no subquery)
SELECT
  user_segment, category,
  round(avg(price_shown), 2)  AS avg_willingness_to_pay,
  round(countIf(converted=1)/count()*100, 1) AS conversion_pct,
  count()                     AS sessions
FROM demo.sp_user_sessions
GROUP BY user_segment, category
ORDER BY user_segment, sessions DESC
LIMIT 3 BY user_segment  -- ClickHouse top-N-per-group`),
      'sp-body-4'
    )}

          <!-- USE CASE 5: Vendor Feed -->
          ${spCard(5,
      'Real-Time Vendor Feed Ingestion', '📡',
      'Simulate live vendor price updates. ReplacingMergeTree deduplicates stale data — only the latest price per vendor+SKU survives.',
      'ReplacingMergeTree(feed_version)', '#14b8a6',
      spSql(`-- Live insert (e.g. from Kafka consumer):
INSERT INTO demo.sp_vendor_feed VALUES
  (now(), 'amzn', 'SKU00001', 'Wireless Earbuds Pro', 'Electronics',
   89.99, 1, toUnixTimestamp(now()));

-- Query current state (deduped):
SELECT vendor_id, sku_id, price_usd, in_stock, ingested_at
FROM demo.sp_vendor_feed FINAL  -- forces sync dedup
WHERE sku_id = 'SKU00001'
ORDER BY price_usd ASC`),
      'sp-body-5'
    )}
          <div class="sp-controls glass" style="margin-bottom:8px">
            <label class="sp-ctrl-label">Vendor:</label>
            <select id="sp-feed-vendor" class="sp-select">
              <option value="amzn">Amazon</option><option value="wmt">Walmart</option>
              <option value="tgt">Target</option><option value="bby">Best Buy</option>
              <option value="cost">Costco</option><option value="ebay">eBay</option>
              <option value="wfair">Wayfair</option><option value="nke">Nike.com</option>
            </select>
            <label class="sp-ctrl-label">SKU:</label>
            <select id="sp-feed-sku" class="sp-select">
              ${Array.from({ length: 10 }, (_, i) => `<option value="SKU${String(i + 1).padStart(5, '0')}">SKU${String(i + 1).padStart(5, '0')}</option>`).join('')}
            </select>
            <label class="sp-ctrl-label">Price $:</label>
            <input id="sp-feed-price" type="number" class="sp-input" value="79.99" step="0.01" min="1" style="width:90px">
              <label class="sp-ctrl-label">In Stock:</label>
              <select id="sp-feed-stock" class="sp-select" style="width:80px">
                <option value="1">Yes</option><option value="0">No</option>
              </select>
              <button class="btn" onclick="spInsertFeed()" style="margin-left:8px;background:linear-gradient(135deg,#10b981,#059669)">📡 Insert Feed Row</button>
              <div id="sp-feed-result" style="margin-top:8px;font-size:12px"></div>
          </div>

          <!-- USE CASE 6: Catalog Intelligence -->
          ${spCard(6,
      'Product Catalog Intelligence', '📦',
      'Brand market share, category depth, data freshness scoring, top-rated products — all from a deduplicated ReplacingMergeTree.',
      'ReplacingMergeTree + FINAL', '#a3e635',
      spSql(`-- Brand market share (deduped catalog):
SELECT
  brand,
  count()                   AS products,
  sum(review_count)         AS total_reviews,
  round(avg(avg_rating), 2) AS avg_rating,
  round(avg(min_price_usd), 2) AS avg_min_price
FROM demo.sp_product_catalog FINAL  -- latest catalog version per SKU
GROUP BY brand
ORDER BY total_reviews DESC
LIMIT 10`),
      'sp-body-6'
    )}

          <!-- USE CASE 7: Live Dashboards (MV) -->
          ${spCard(7,
      'Materialized Views for Live Dashboards', '⚡',
      'Pre-aggregate price data as it lands. Dashboards query AggregatingMergeTree partial states — not raw rows. Compare raw vs. MV query times.',
      'AggregatingMergeTree + MV', '#f9c74f',
      spSql(`-- MV definition (fires on every INSERT):
CREATE MATERIALIZED VIEW demo.mv_sp_price_hourly
TO demo.sp_price_hourly_agg AS
SELECT
  toStartOfHour(event_ts) AS hour, category, vendor_id,
  countState()     AS price_count,
  avgState(price_usd)  AS avg_price,
  minState(price_usd)  AS min_price,
  uniqState(sku_id)    AS unique_skus
FROM demo.sp_price_events GROUP BY hour, category, vendor_id;

-- Dashboard query (reads pre-aggregated states, not raw rows):
SELECT hour, vendor_id,
  countMerge(price_count)      AS price_updates,
  round(avgMerge(avg_price),2) AS avg_price,
  uniqMerge(unique_skus)       AS unique_skus
FROM demo.sp_price_hourly_agg
WHERE category = 'Electronics' AND hour >= now() - INTERVAL 7 DAY
GROUP BY hour, vendor_id ORDER BY hour DESC`),
      'sp-body-7'
    )}
          <div class="sp-controls glass" style="margin-bottom:8px">
            <label class="sp-ctrl-label">Category:</label>
            <select id="sp-mv-cat-select" class="sp-select">${catOptions}</select>
            <button class="btn" onclick="spRun7()" style="margin-left:8px">Apply</button>
          </div>

          <!-- USE CASE 8: Async Inserts -->
          ${spCard(8,
      'Async Inserts + Deduplication', '🚀',
      'High-throughput fire-and-forget writes: ClickHouse buffers inserts server-side, flushes in batches, and deduplicates retried blocks automatically.',
      'async_insert + dedup', '#6366f1',
      spSql(`-- Enable async insert (per query or user setting):
-- SET async_insert = 1;
-- SET wait_for_async_insert = 0;       -- fire and forget
-- SET async_insert_deduplicate = 1;    -- drop duplicate blocks

-- Same INSERT syntax — buffer handled by ClickHouse:
INSERT INTO demo.sp_async_feed_demo
  (vendor_id, sku_id, price_usd, batch_id)
VALUES ('amzn', 'SKU00001', 89.99, 'batch-1234');

-- Check what was flushed:
SELECT status, rows, bytes, event_time
FROM system.async_insert_log
WHERE table = 'sp_async_feed_demo'
ORDER BY event_time DESC LIMIT 10`),
      'sp-body-8'
    )}
          <div class="sp-insight" style="margin:8px 0 16px">
            💡 Click <strong>Run Query</strong> to fire 2 identical batches of 25 rows.
            The second batch is deduplicated — only 25 rows land in the database.
          </div>

          <!-- USE CASE 9: Dictionaries -->
          ${spCard(9,
      'Dictionaries — Fast Key-Value Enrichment', '📖',
      'Load reference data (product catalog) into memory as a dictionary. Enrich 60k price events with brand/category using O(1) dictGet() instead of a JOIN.',
      'CREATE DICTIONARY + FLAT()', '#ec4899',
      spSql(`-- Create a flat in-memory dictionary from product catalog:
CREATE DICTIONARY demo.product_dict (
  sku_id        String,
  product_name  String   DEFAULT 'Unknown',
  category      String   DEFAULT 'Unknown',
  brand         String   DEFAULT 'Unknown',
  avg_rating    Float32  DEFAULT 0.0
)
PRIMARY KEY sku_id
SOURCE(CLICKHOUSE(TABLE 'sp_product_catalog' DB 'demo'))
LAYOUT(FLAT())           -- entire dict in flat array, O(1) lookup
LIFETIME(MIN 0 MAX 300); -- auto-reload every 0-300 seconds

-- Use it to enrich price events (no JOIN needed!):
SELECT
  sku_id, vendor_id,
  round(avg(price_usd), 2)                            AS avg_price,
  dictGet('demo.product_dict', 'brand',    sku_id)    AS brand,
  dictGet('demo.product_dict', 'category', sku_id)    AS category,
  dictGet('demo.product_dict', 'avg_rating', sku_id)  AS rating
FROM demo.sp_price_events
WHERE event_ts >= now() - INTERVAL 7 DAY
GROUP BY sku_id, vendor_id
ORDER BY avg_price DESC LIMIT 15;

-- Safe lookup with fallback:
SELECT dictGetOrDefault('demo.product_dict', 'brand', 'SKU_UNKNOWN', 'N/A');`),
      'sp-body-9'
    )}

          <!-- USE CASE 10: Personalization Feed -->
          ${spCard(10,
      'Personalization Feed — Extension Events → Real-Time Homepage', '🧠',
      'Browser extension streams page views → MV aggregates on INSERT → homepage queries AggMT for a ranked feed. Zero cron, sub-millisecond latency, flexible filters.',
      'AggregatingMergeTree + Materialized View', '#a855f7',
      spSql(`-- The MV fires on every INSERT (defined once, runs forever):
CREATE MATERIALIZED VIEW demo.pv_mv TO demo.pv_user_profile AS
SELECT
    user_id, domain, category,
    countState()           AS view_count,
    sumState(dwell_ms)     AS total_dwell_ms,
    maxState(viewed_at)    AS last_seen,
    uniqState(product_id)  AS unique_products
FROM demo.page_views
GROUP BY user_id, domain, category;

-- Homepage feed query (reads compressed partial states, not raw rows):
SELECT
    domain, category,
    countMerge(view_count)                                              AS views,
    round(sumMerge(total_dwell_ms) / countMerge(view_count) / 1000, 1) AS avg_dwell_sec,
    uniqMerge(unique_products)                                          AS products_seen,
    round(countMerge(view_count) * 10.0 /
        (1 + dateDiff('hour', maxMerge(last_seen), now())), 2)         AS relevance_score
FROM demo.pv_user_profile
WHERE user_id = 'user_001'
GROUP BY domain, category
ORDER BY relevance_score DESC LIMIT 10;`),
      'sp-body-10'
    )}

          <div class="sp-footer glass">
            <div class="sp-footer-title">🛍️ Shoppers Paradise — ClickHouse Architecture</div>
            <div class="sp-footer-grid">
              <div><strong>sp_price_events</strong><br><span>MergeTree — 60k rows</span></div>
              <div><strong>sp_coupon_events</strong><br><span>MergeTree — ~35k rows</span></div>
              <div><strong>sp_cashback_events</strong><br><span>MergeTree — 20k rows</span></div>
              <div><strong>sp_user_sessions</strong><br><span>MergeTree — 40k rows</span></div>
              <div><strong>sp_vendor_feed</strong><br><span>ReplacingMergeTree — 300 rows</span></div>
              <div><strong>sp_product_catalog</strong><br><span>ReplacingMergeTree — 30 rows</span></div>
              <div><strong>sp_price_hourly_agg</strong><br><span>AggregatingMergeTree (MV target)</span></div>
              <div><strong>mv_sp_price_hourly</strong><br><span>Materialized View trigger</span></div>
            </div>
          </div>`;
  // Draw flow diagram connections after layout settles
  requestAnimationFrame(() => requestAnimationFrame(spDrawFlowLines));
}
