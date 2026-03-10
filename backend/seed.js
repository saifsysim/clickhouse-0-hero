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

// ─────────────────────────────────────────────────────────────────────────────
// 🛍️  SHOPPERS PARADISE — DDL
// ─────────────────────────────────────────────────────────────────────────────
const SP_DDL = [
    // 1. Price events — MergeTree — price intelligence & trend analysis
    `CREATE TABLE IF NOT EXISTS demo.sp_price_events (
        event_ts    DateTime,
        vendor_id   LowCardinality(String),
        vendor_name LowCardinality(String),
        sku_id      String,
        product_name String,
        category    LowCardinality(String),
        brand       LowCardinality(String),
        price_usd   Float64,
        was_price   Float64,
        in_stock    UInt8
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(event_ts)
    ORDER BY (category, vendor_id, sku_id, event_ts)
    COMMENT 'Vendor price feed events — Price Intelligence'`,

    // 2. Coupon events — MergeTree — coupon funnel analysis
    `CREATE TABLE IF NOT EXISTS demo.sp_coupon_events (
        event_ts       DateTime,
        user_id        String,
        coupon_code    LowCardinality(String),
        vendor_id      LowCardinality(String),
        category       LowCardinality(String),
        discount_pct   UInt8,
        stage          LowCardinality(String),  -- seen,clicked,applied,converted
        order_usd      Float64,
        savings_usd    Float64
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(event_ts)
    ORDER BY (vendor_id, coupon_code, event_ts)
    COMMENT 'Coupon funnel events — Coupon & Deal Effectiveness'`,

    // 3. Cashback events — MergeTree — attribution
    `CREATE TABLE IF NOT EXISTS demo.sp_cashback_events (
        event_ts       DateTime,
        user_id        String,
        session_id     String,
        vendor_id      LowCardinality(String),
        vendor_name    LowCardinality(String),
        order_usd      Float64,
        cashback_usd   Float64,
        cashback_pct   Float64,
        affiliate_revenue_usd Float64,
        attributed     UInt8
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(event_ts)
    ORDER BY (vendor_id, user_id, event_ts)
    COMMENT 'Cashback & affiliate attribution events'`,

    // 4. User sessions — MergeTree — behavior & personalization
    `CREATE TABLE IF NOT EXISTS demo.sp_user_sessions (
        session_ts     DateTime,
        user_id        String,
        user_segment   LowCardinality(String),  -- bargain-hunter,brand-loyal,impulse-buyer,researcher
        vendor_id      LowCardinality(String),
        vendor_name    LowCardinality(String),
        page_type      LowCardinality(String),  -- search,pdp,cart,checkout,compare
        sku_id         String,
        category       LowCardinality(String),
        time_on_page_s UInt32,
        converted      UInt8,
        price_shown    Float64
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(session_ts)
    ORDER BY (user_segment, user_id, session_ts)
    COMMENT 'User session events — Behavior & Personalization'`,

    // 5. Vendor feed — ReplacingMergeTree — latest price per vendor+sku
    `CREATE TABLE IF NOT EXISTS demo.sp_vendor_feed (
        ingested_at    DateTime,
        vendor_id      LowCardinality(String),
        sku_id         String,
        product_name   String,
        category       LowCardinality(String),
        price_usd      Float64,
        in_stock       UInt8,
        feed_version   UInt64
    )
    ENGINE = ReplacingMergeTree(feed_version)
    PARTITION BY toYYYYMM(ingested_at)
    ORDER BY (vendor_id, sku_id)
    COMMENT 'Live vendor feed — ReplacingMergeTree dedup demo'`,

    // 6. Product catalog — ReplacingMergeTree — brand market share
    `CREATE TABLE IF NOT EXISTS demo.sp_product_catalog (
        updated_at     DateTime,
        sku_id         String,
        product_name   String,
        brand          LowCardinality(String),
        category       LowCardinality(String),
        vendor_count   UInt16,
        avg_price_usd  Float64,
        min_price_usd  Float64,
        review_count   UInt32,
        avg_rating     Float32,
        catalog_version UInt64
    )
    ENGINE = ReplacingMergeTree(catalog_version)
    PARTITION BY toYYYYMM(updated_at)
    ORDER BY (category, brand, sku_id)
    COMMENT 'Product catalog — Catalog Intelligence'`,

    // 7. MV target table — AggregatingMergeTree — live dashboard
    `CREATE TABLE IF NOT EXISTS demo.sp_price_hourly_agg (
        hour           DateTime,
        category       LowCardinality(String),
        vendor_id      LowCardinality(String),
        price_count    AggregateFunction(count),
        avg_price      AggregateFunction(avg, Float64),
        min_price      AggregateFunction(min, Float64),
        unique_skus    AggregateFunction(uniq, String)
    )
    ENGINE = AggregatingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY (category, vendor_id, hour)
    COMMENT 'Pre-aggregated price rollup — Materialized View demo'`,

    // 8. The Materialized View that feeds the above
    `CREATE MATERIALIZED VIEW IF NOT EXISTS demo.mv_sp_price_hourly
    TO demo.sp_price_hourly_agg
    AS
    SELECT
        toStartOfHour(event_ts) AS hour,
        category,
        vendor_id,
        countState()            AS price_count,
        avgState(price_usd)     AS avg_price,
        minState(price_usd)     AS min_price,
        uniqState(sku_id)       AS unique_skus
    FROM demo.sp_price_events
    GROUP BY hour, category, vendor_id`,
];

// ─── Shoppers Paradise — Reference Data ──────────────────────────────────────
const SP_VENDORS = [
    { id: 'amzn', name: 'Amazon' },
    { id: 'wmt', name: 'Walmart' },
    { id: 'tgt', name: 'Target' },
    { id: 'bby', name: 'Best Buy' },
    { id: 'cost', name: 'Costco' },
    { id: 'ebay', name: 'eBay' },
    { id: 'wfair', name: 'Wayfair' },
    { id: 'hd', name: 'Home Depot' },
    { id: 'nke', name: 'Nike.com' },
    { id: 'mcy', name: "Macy's" },
];
const SP_CATEGORIES = ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Beauty', 'Toys', 'Grocery', 'Automotive'];
const SP_BRANDS = ['Samsung', 'Apple', 'Nike', 'Sony', 'LG', 'Levi\'s', 'KitchenAid', 'Dyson', 'Adidas', 'Bose', 'Cuisinart', 'Instant Pot', 'Fitbit', 'Anker'];
const SP_SEGMENTS = ['bargain-hunter', 'brand-loyal', 'impulse-buyer', 'researcher'];
const SP_COUPON_CODES = ['SAVE10', 'FLASH20', 'MEMBER15', 'WEEKEND5', 'NEWUSER25', 'LOYALTY30', 'CLEARANCE40', 'APP10'];
const SP_STAGES = ['seen', 'clicked', 'applied', 'converted'];

// Generate 200 realistic SKUs
const SP_SKUS = [];
const SP_SKU_PRODUCTS = [
    'Wireless Earbuds Pro', 'Smart Watch Series X', 'Portable Charger 20000mAh', '4K Monitor 27"', 'Mechanical Keyboard RGB',
    'Running Shoes Ultra', 'Yoga Mat Premium', 'Instant Pot 6Qt', 'Air Fryer XL', 'Robot Vacuum S9',
    'Skincare Face Serum', 'Vitamin C Gummies', 'Standing Desk Frame', 'Gaming Chair Pro', 'LED Strip Lights 32ft',
    'Coffee Maker 12-Cup', 'Blender Professional', 'Knife Set 15pc', 'Cast Iron Skillet 12"', 'Shower Head 5-Setting',
    'Winter Jacket Parka', 'Denim Jeans Slim Fit', 'Sneakers Classic White', 'Backpack 40L', 'Sunglasses Polarized',
    'LEGO Technic 42150', 'Drone DJI Mini 3', 'GoPro Hero 12', 'SSD 1TB Portable', 'Webcam 4K',
];
for (let i = 0; i < SP_SKU_PRODUCTS.length; i++) {
    SP_SKUS.push({ id: `SKU${String(i + 1).padStart(5, '0')}`, name: SP_SKU_PRODUCTS[i], category: SP_CATEGORIES[i % SP_CATEGORIES.length], brand: SP_BRANDS[i % SP_BRANDS.length], basePrice: 15 + (i * 12.5) });
}

// ─── Shoppers Paradise — Seed Functions ──────────────────────────────────────
async function seedPriceEvents(n = 60_000) {
    console.log(`  💰 Seeding ${n} price events…`);
    const rows = [];
    for (let i = 0; i < n; i++) {
        const sku = pick(SP_SKUS);
        const vendor = pick(SP_VENDORS);
        const basePrice = sku.basePrice;
        const priceVariance = rnd(0.7, 1.4);
        const price = parseFloat((basePrice * priceVariance).toFixed(2));
        const wasPrice = parseFloat((price * rnd(1.05, 1.45)).toFixed(2));
        rows.push({
            event_ts: tsAgo(rnd(0, 168)), // 7 days
            vendor_id: vendor.id,
            vendor_name: vendor.name,
            sku_id: sku.id,
            product_name: sku.name,
            category: sku.category,
            brand: sku.brand,
            price_usd: price,
            was_price: wasPrice,
            in_stock: Math.random() > 0.12 ? 1 : 0,
        });
    }
    // Batch insert 10k at a time
    for (let i = 0; i < rows.length; i += 10000) {
        await ch.insert({ table: 'demo.sp_price_events', values: rows.slice(i, i + 10000), format: 'JSONEachRow' });
        process.stdout.write('.');
    }
}

async function seedCouponEvents(n = 25_000) {
    console.log(`\n  🎟️  Seeding ${n} coupon events…`);
    const rows = [];
    const stageWeights = [1.0, 0.55, 0.28, 0.14]; // funnel drop-off
    for (let i = 0; i < n; i++) {
        const vendor = pick(SP_VENDORS);
        const coupon = pick(SP_COUPON_CODES);
        const discountPct = parseInt(coupon.replace(/\D/g, '')) || 10;
        const orderUsd = parseFloat((rnd(20, 400)).toFixed(2));
        const savingsUsd = parseFloat((orderUsd * discountPct / 100).toFixed(2));
        const maxStage = stageWeights.findIndex(w => Math.random() > w);
        const stagesToInsert = SP_STAGES.slice(0, maxStage === -1 ? 4 : Math.max(1, maxStage));
        for (const stage of stagesToInsert) {
            rows.push({
                event_ts: tsAgo(rnd(0, 72)),
                user_id: `user-${rndInt(1, 5000)}`,
                coupon_code: coupon,
                vendor_id: vendor.id,
                category: pick(SP_CATEGORIES),
                discount_pct: discountPct,
                stage,
                order_usd: stage === 'converted' ? orderUsd : 0,
                savings_usd: stage === 'converted' ? savingsUsd : 0,
            });
        }
    }
    for (let i = 0; i < rows.length; i += 10000) {
        await ch.insert({ table: 'demo.sp_coupon_events', values: rows.slice(i, i + 10000), format: 'JSONEachRow' });
        process.stdout.write('.');
    }
}

async function seedCashbackEvents(n = 20_000) {
    console.log(`\n  💸 Seeding ${n} cashback events…`);
    const rows = [];
    for (let i = 0; i < n; i++) {
        const vendor = pick(SP_VENDORS);
        const orderUsd = parseFloat((rnd(15, 500)).toFixed(2));
        const cashbackPct = rnd(1, 12);
        const cashbackUsd = parseFloat((orderUsd * cashbackPct / 100).toFixed(2));
        const affiliateUsd = parseFloat((orderUsd * rnd(0.04, 0.10)).toFixed(2));
        rows.push({
            event_ts: tsAgo(rnd(0, 720)), // 30 days
            user_id: `user-${rndInt(1, 8000)}`,
            session_id: `sess-${Math.random().toString(36).slice(2, 12)}`,
            vendor_id: vendor.id,
            vendor_name: vendor.name,
            order_usd: orderUsd,
            cashback_usd: cashbackUsd,
            cashback_pct: parseFloat(cashbackPct.toFixed(2)),
            affiliate_revenue_usd: affiliateUsd,
            attributed: Math.random() > 0.08 ? 1 : 0,
        });
    }
    for (let i = 0; i < rows.length; i += 10000) {
        await ch.insert({ table: 'demo.sp_cashback_events', values: rows.slice(i, i + 10000), format: 'JSONEachRow' });
        process.stdout.write('.');
    }
}

async function seedUserSessions(n = 40_000) {
    console.log(`\n  👤 Seeding ${n} user sessions…`);
    const rows = [];
    const pageTypes = ['search', 'pdp', 'cart', 'checkout', 'compare'];
    for (let i = 0; i < n; i++) {
        const vendor = pick(SP_VENDORS);
        const sku = pick(SP_SKUS);
        const segment = pick(SP_SEGMENTS);
        const converted = Math.random() > 0.82 ? 1 : 0;
        rows.push({
            session_ts: tsAgo(rnd(0, 336)), // 14 days
            user_id: `user-${rndInt(1, 6000)}`,
            user_segment: segment,
            vendor_id: vendor.id,
            vendor_name: vendor.name,
            page_type: pick(pageTypes),
            sku_id: sku.id,
            category: sku.category,
            time_on_page_s: rndInt(5, 480),
            converted,
            price_shown: parseFloat((sku.basePrice * rnd(0.8, 1.3)).toFixed(2)),
        });
    }
    for (let i = 0; i < rows.length; i += 10000) {
        await ch.insert({ table: 'demo.sp_user_sessions', values: rows.slice(i, i + 10000), format: 'JSONEachRow' });
        process.stdout.write('.');
    }
}

async function seedVendorFeed() {
    console.log('\n  📡 Seeding vendor feed (latest prices per vendor+SKU)…');
    const rows = [];
    for (const vendor of SP_VENDORS) {
        for (const sku of SP_SKUS) {
            const price = parseFloat((sku.basePrice * rnd(0.75, 1.35)).toFixed(2));
            rows.push({
                ingested_at: tsAgo(rnd(0, 2)),
                vendor_id: vendor.id,
                sku_id: sku.id,
                product_name: sku.name,
                category: sku.category,
                price_usd: price,
                in_stock: Math.random() > 0.10 ? 1 : 0,
                feed_version: Date.now() + rndInt(0, 1000),
            });
        }
    }
    await ch.insert({ table: 'demo.sp_vendor_feed', values: rows, format: 'JSONEachRow' });
    process.stdout.write('.');
}

async function seedProductCatalog() {
    console.log('\n  📦 Seeding product catalog…');
    const rows = [];
    for (const sku of SP_SKUS) {
        rows.push({
            updated_at: tsAgo(rnd(0, 48)),
            sku_id: sku.id,
            product_name: sku.name,
            brand: sku.brand,
            category: sku.category,
            vendor_count: rndInt(2, 9),
            avg_price_usd: parseFloat((sku.basePrice * rnd(0.9, 1.1)).toFixed(2)),
            min_price_usd: parseFloat((sku.basePrice * rnd(0.7, 0.95)).toFixed(2)),
            review_count: rndInt(50, 12000),
            avg_rating: parseFloat((rnd(3.2, 5.0)).toFixed(1)),
            catalog_version: Date.now(),
        });
    }
    await ch.insert({ table: 'demo.sp_product_catalog', values: rows, format: 'JSONEachRow' });
    process.stdout.write('.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🔧 Running DDL…');
    for (const ddl of DDL) {
        await ch.command({ query: ddl });
        process.stdout.write('.');
    }
    console.log('\n\n🛍️  Running Shoppers Paradise DDL…');
    for (const ddl of SP_DDL) {
        await ch.command({ query: ddl });
        process.stdout.write('.');
    }
    console.log('\n✅ Schema ready\n');

    // ─── Dictionary (runs after sp_product_catalog DDL) ───────────────────────
    console.log('📖  Creating product_dict dictionary…');
    await ch.command({
        query: `
        CREATE DICTIONARY IF NOT EXISTS demo.product_dict (
            sku_id         String,
            product_name   String   DEFAULT 'Unknown',
            category       String   DEFAULT 'Unknown',
            brand          String   DEFAULT 'Unknown',
            avg_rating     Float32  DEFAULT 0.0,
            vendor_count   UInt8    DEFAULT 0
        )
        PRIMARY KEY sku_id
        SOURCE(CLICKHOUSE(TABLE 'sp_product_catalog' DB 'demo'))
        LAYOUT(FLAT())
        LIFETIME(MIN 0 MAX 300)
    ` });

    // ─── Async-insert dedup sink ───────────────────────────────────────────────
    await ch.command({
        query: `
        CREATE TABLE IF NOT EXISTS demo.sp_async_feed_demo (
            inserted_at  DateTime DEFAULT now(),
            vendor_id    LowCardinality(String),
            sku_id       String,
            price_usd    Float64,
            batch_id     String   -- used to demonstrate dedup: same batch_id = duplicate
        )
        ENGINE = ReplacingMergeTree(inserted_at)
        ORDER BY (vendor_id, sku_id, batch_id)
    ` });
    console.log('✅ Dictionary + async demo table ready\n');


    // ─── UC10: Personalization Feed DDL ───────────────────────────────────────
    console.log('🧠  Creating personalization feed tables…');

    // Drop + recreate so re-running seed is idempotent
    await ch.command({ query: `DROP TABLE   IF EXISTS demo.page_views` });
    await ch.command({ query: `DROP TABLE   IF EXISTS demo.pv_user_profile` });
    await ch.command({ query: `DROP VIEW    IF EXISTS demo.pv_mv` });

    // Raw page view events (written by the browser extension)
    await ch.command({
        query: `
        CREATE TABLE demo.page_views (
            user_id     String,
            session_id  String,
            domain      String,
            url_path    String,
            category    LowCardinality(String),
            product_id  String,
            dwell_ms    UInt32,
            viewed_at   DateTime
        )
        ENGINE = MergeTree()
        ORDER BY (user_id, domain, viewed_at)
        PARTITION BY toYYYYMM(viewed_at)
    ` });

    // AggregatingMergeTree — receives MV state, queried for the feed
    await ch.command({
        query: `
        CREATE TABLE demo.pv_user_profile (
            user_id         String,
            domain          String,
            category        LowCardinality(String),
            view_count      AggregateFunction(count,   UInt8),
            total_dwell_ms  AggregateFunction(sum,     UInt32),
            last_seen       AggregateFunction(max,     DateTime),
            unique_products AggregateFunction(uniq,    String)
        )
        ENGINE = AggregatingMergeTree()
        ORDER BY (user_id, domain, category)
    ` });

    // Materialized View — fires on every INSERT into page_views, zero cron needed
    await ch.command({
        query: `
        CREATE MATERIALIZED VIEW demo.pv_mv
        TO demo.pv_user_profile AS
        SELECT
            user_id,
            domain,
            category,
            countState()              AS view_count,
            sumState(dwell_ms)        AS total_dwell_ms,
            maxState(viewed_at)       AS last_seen,
            uniqState(product_id)     AS unique_products
        FROM demo.page_views
        GROUP BY user_id, domain, category
    ` });

    console.log('✅ Personalization feed schema ready\n');

    console.log('🌱 Seeding core demo data…');
    await seedTelemetry();
    await seedLogs();
    await seedCosts();
    await seedErrorSummary();
    await seedBudgetLimits();

    console.log('\n\n🛍️  Seeding Shoppers Paradise data…');
    await seedPriceEvents();
    await seedCouponEvents();
    await seedCashbackEvents();
    await seedUserSessions();
    await seedVendorFeed();
    await seedProductCatalog();

    console.log('\n\n🧠  Seeding page view events (UC10)…');
    await seedPageViews();

    console.log('\n\n🎉 All done! ClickHouse Explorer + Shoppers Paradise ready.\n');
    await ch.close();
}

// ── UC10 seed: 50k synthetic browser-extension page view events ─────────────
async function seedPageViews() {
    const users = Array.from({ length: 20 }, (_, i) => `user_${String(i + 1).padStart(3, '0')}`);
    const domains = [
        'amazon.com', 'walmart.com', 'target.com', 'bestbuy.com', 'etsy.com',
        'ebay.com', 'homedepot.com', 'costco.com', 'wayfair.com', 'chewy.com',
        'sephora.com', 'nike.com', 'adidas.com', 'gap.com', 'zara.com',
    ];
    const categories = ['Electronics', 'Fashion', 'Home', 'Sports', 'Beauty', 'Grocery', 'Toys', 'Books'];
    const paths = ['/product', '/search', '/category', '/deals', '/cart'];

    const TOTAL = 50_000;
    const BATCH = 5_000;
    let inserted = 0;

    const now = Math.floor(Date.now() / 1000);
    const SEVEN_DAYS = 7 * 24 * 3600;

    const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

    while (inserted < TOTAL) {
        const count = Math.min(BATCH, TOTAL - inserted);
        const rows = [];
        for (let i = 0; i < count; i++) {
            const user = rand(users);
            const domain = rand(domains);
            const cat = rand(categories);
            // weight: each user has 2-3 "favourite" domains they visit more often
            const userIdx = parseInt(user.split('_')[1]);
            const favDomains = [domains[userIdx % domains.length], domains[(userIdx + 3) % domains.length]];
            const actualDomain = Math.random() < 0.55 ? rand(favDomains) : domain;
            const ts = now - Math.floor(Math.random() * SEVEN_DAYS);
            rows.push({
                user_id: user,
                session_id: `sess_${user}_${ts}`,
                domain: actualDomain,
                url_path: rand(paths),
                category: cat,
                product_id: `P${randInt(1000, 9999)}`,
                dwell_ms: randInt(500, 120_000),
                viewed_at: new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19),
            });
        }
        await ch.insert({ table: 'demo.page_views', values: rows, format: 'JSONEachRow' });
        inserted += count;
        process.stdout.write(`  page_views: ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()}\r`);
    }
    console.log(`\n✅ page_views seeded: ${TOTAL.toLocaleString()} events`);
}

main().catch(e => { console.error(e); process.exit(1); });

