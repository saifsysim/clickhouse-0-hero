/**
 * seed.js  –  Populate ClickHouse with demo data for all 3 use-cases
 *             Run with:  node seed.js
 */
const { createClient } = require('@clickhouse/client');

const ch = createClient({
    host: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 8123}`,
    database: process.env.CLICKHOUSE_DB || 'demo',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rnd = (a, b) => Math.random() * (b - a) + a;
const rndInt = (a, b) => Math.floor(rnd(a, b));
const pick = arr => arr[rndInt(0, arr.length)];
const tsAgo = (hoursAgo) => {
    const d = new Date(Date.now() - hoursAgo * 3_600_000 - rnd(0, 3600000));
    return d.toISOString().replace('T', ' ').slice(0, 19);
};

const SERVICES = ['frontend', 'api-gateway', 'auth-service', 'payment-service', 'recommendation-engine', 'data-pipeline', 'ml-inference'];
const TEAMS = ['core-platform', 'data-science', 'product', 'infra', 'growth'];
const HOSTS = Array.from({ length: 20 }, (_, i) => `host-${String(i + 1).padStart(2, '0')}`);
const LOG_LEVELS = ['DEBUG', 'INFO', 'INFO', 'INFO', 'WARN', 'ERROR'];
const EVENT_TYPES = ['page_view', 'click', 'search', 'purchase', 'signup', 'api_call', 'feature_flag'];

// ─── DDL ──────────────────────────────────────────────────────────────────────
const DDL = [
    `CREATE DATABASE IF NOT EXISTS demo`,

    // 1. Telemetry  –  MergeTree (append, high-throughput ingest, ORDER BY time)
    `CREATE TABLE IF NOT EXISTS demo.telemetry_events
   (
     timestamp    DateTime,
     service      LowCardinality(String),
     event_type   LowCardinality(String),
     user_id      String,
     properties   String,          -- JSON blob
     duration_ms  UInt32 DEFAULT toUInt32(rand() % 2000)
   )
   ENGINE = MergeTree()
   PARTITION BY toYYYYMM(timestamp)
   ORDER BY (service, event_type, timestamp)
   COMMENT 'Telemetry events – MergeTree engine demo'`,

    // 2. Application Logs  –  MergeTree with TTL (auto-expire old rows)
    `CREATE TABLE IF NOT EXISTS demo.app_logs
   (
     timestamp    DateTime,
     level        LowCardinality(String),
     service      LowCardinality(String),
     host         LowCardinality(String),
     message      String,
     trace_id     String,
     duration_ms  UInt32 DEFAULT toUInt32(rand() % 500)
   )
   ENGINE = MergeTree()
   PARTITION BY toYYYYMM(timestamp)
   ORDER BY (level, service, timestamp)
   TTL timestamp + INTERVAL 90 DAY
   COMMENT 'Application logs – MergeTree with TTL demo'`,

    // 3. Cost & Usage  –  SummingMergeTree (auto-aggregate on merge)
    `CREATE TABLE IF NOT EXISTS demo.cost_usage
   (
     timestamp   DateTime,
     service     LowCardinality(String),
     team        LowCardinality(String),
     cost_usd    Float64,
     tokens_used UInt64,
     api_calls   UInt32
   )
   ENGINE = SummingMergeTree((cost_usd, tokens_used, api_calls))
   PARTITION BY toYYYYMM(timestamp)
   ORDER BY (team, service, timestamp)
   COMMENT 'Cost & usage tracking – SummingMergeTree demo'`,

    // 4. Materialized View  –  AggregatingMergeTree (pre-aggregated rollups)
    `CREATE TABLE IF NOT EXISTS demo.telemetry_hourly_agg
   (
     hour         DateTime,
     service      LowCardinality(String),
     event_type   LowCardinality(String),
     event_count  AggregateFunction(count),
     unique_users AggregateFunction(uniq, String),
     p95_duration AggregateFunction(quantile(0.95), UInt32)
   )
   ENGINE = AggregatingMergeTree()
   PARTITION BY toYYYYMM(hour)
   ORDER BY (service, event_type, hour)
   COMMENT 'Pre-aggregated telemetry rollup – AggregatingMergeTree demo'`,

    `CREATE MATERIALIZED VIEW IF NOT EXISTS demo.mv_telemetry_hourly
   TO demo.telemetry_hourly_agg
   AS
   SELECT
     toStartOfHour(timestamp) AS hour,
     service,
     event_type,
     countState()                 AS event_count,
     uniqState(user_id)           AS unique_users,
     quantileState(0.95)(duration_ms) AS p95_duration
   FROM demo.telemetry_events
   GROUP BY hour, service, event_type`,

    // 5. Log error summary – ReplacingMergeTree (de-duplicate on merge)
    `CREATE TABLE IF NOT EXISTS demo.error_summary
   (
     date       Date,
     service    LowCardinality(String),
     error_msg  String,
     count      UInt32,
     version    UInt64 DEFAULT toUnixTimestamp(now())
   )
   ENGINE = ReplacingMergeTree(version)
   PARTITION BY toYYYYMM(date)
   ORDER BY (date, service, error_msg)
   COMMENT 'Error deduplication – ReplacingMergeTree demo'`,

    // 6. Budget limits – CollapsingMergeTree (correct previous values)
    `CREATE TABLE IF NOT EXISTS demo.budget_limits
   (
     date       Date,
     team       LowCardinality(String),
     budget_usd Float64,
     sign       Int8    -- +1 new row, -1 cancels previous
   )
   ENGINE = CollapsingMergeTree(sign)
   ORDER BY (date, team)
   COMMENT 'Budget corrections – CollapsingMergeTree demo'`,
];

// ─── Seed Data ────────────────────────────────────────────────────────────────
async function seedTelemetry(n = 30_000) {
    console.log(`  📡 Seeding ${n} telemetry events…`);
    const rows = [];
    for (let i = 0; i < n; i++) {
        rows.push({
            timestamp: tsAgo(rnd(0, 72)),
            service: pick(SERVICES),
            event_type: pick(EVENT_TYPES),
            user_id: `user-${rndInt(1, 2000)}`,
            properties: JSON.stringify({ page: `/page/${rndInt(1, 50)}`, referrer: pick(['google', 'direct', 'twitter', 'email']) }),
            duration_ms: rndInt(10, 3000),
        });
    }
    await ch.insert({ table: 'demo.telemetry_events', values: rows, format: 'JSONEachRow' });
}

const LOG_MESSAGES = {
    DEBUG: ['Cache hit for key %s', 'DB query took %dms', 'Config loaded', 'Request received'],
    INFO: ['Request processed in %dms', 'User %s logged in', 'Payment processed', 'Email sent', 'Session started'],
    WARN: ['High memory usage: %d%%', 'Slow query detected (%dms)', 'Retry attempt %d', 'Rate limit approaching'],
    ERROR: ['Database connection failed', 'Unhandled exception: NullPointerError', 'Payment gateway timeout', 'Auth token expired', 'Service unreachable'],
};

async function seedLogs(n = 50_000) {
    console.log(`  📋 Seeding ${n} log entries…`);
    const rows = [];
    for (let i = 0; i < n; i++) {
        const level = pick(LOG_LEVELS);
        const msgs = LOG_MESSAGES[level];
        rows.push({
            timestamp: tsAgo(rnd(0, 48)),
            level,
            service: pick(SERVICES),
            host: pick(HOSTS),
            message: pick(msgs).replace('%d', rndInt(10, 9999)).replace('%s', `user-${rndInt(1, 100)}`),
            trace_id: `trace-${Math.random().toString(36).slice(2, 10)}`,
            duration_ms: rndInt(1, 800),
        });
    }
    await ch.insert({ table: 'demo.app_logs', values: rows, format: 'JSONEachRow' });
}

async function seedCosts(n = 10_000) {
    console.log(`  💰 Seeding ${n} cost & usage records…`);
    const rows = [];
    for (let i = 0; i < n; i++) {
        const service = pick(SERVICES);
        const calls = rndInt(1, 1000);
        rows.push({
            timestamp: tsAgo(rnd(0, 720)), // 30 days
            service,
            team: pick(TEAMS),
            cost_usd: parseFloat((calls * rnd(0.001, 0.15)).toFixed(6)),
            tokens_used: calls * rndInt(100, 4000),
            api_calls: calls,
        });
    }
    await ch.insert({ table: 'demo.cost_usage', values: rows, format: 'JSONEachRow' });
}

async function seedErrorSummary() {
    console.log('  ⚠️  Seeding error summary…');
    const rows = [];
    const errors = ['NullPointerError', 'DB connection failed', 'Token expired', 'Rate limit exceeded', 'Timeout'];
    for (const service of SERVICES) {
        for (const err of errors) {
            rows.push({ date: new Date().toISOString().slice(0, 10), service, error_msg: err, count: rndInt(1, 500), version: Date.now() });
        }
    }
    await ch.insert({ table: 'demo.error_summary', values: rows, format: 'JSONEachRow' });
}

async function seedBudgetLimits() {
    console.log('  📊 Seeding budget limits (with corrections)…');
    const rows = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const team of TEAMS) {
        const oldBudget = rndInt(100, 1000);
        const newBudget = rndInt(100, 2000);
        // Insert original row
        rows.push({ date: today, team, budget_usd: oldBudget, sign: 1 });
        // Cancel original row (CollapsingMergeTree pattern)
        rows.push({ date: today, team, budget_usd: oldBudget, sign: -1 });
        // Insert corrected row
        rows.push({ date: today, team, budget_usd: newBudget, sign: 1 });
    }
    await ch.insert({ table: 'demo.budget_limits', values: rows, format: 'JSONEachRow' });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🔧 Running DDL…');
    for (const ddl of DDL) {
        await ch.command({ query: ddl });
        process.stdout.write('.');
    }
    console.log('\n✅ Schema ready\n');

    console.log('🌱 Seeding demo data…');
    await seedTelemetry();
    await seedLogs();
    await seedCosts();
    await seedErrorSummary();
    await seedBudgetLimits();

    console.log('\n🎉 All done! ClickHouse Explorer is ready to explore.\n');
    await ch.close();
}

main().catch(e => { console.error(e); process.exit(1); });
