/**
 * seed-cluster.js  –  Create tables and seed data on the 2-node demo cluster
 *
 * Tables created:
 *  - events_local        (ReplicatedMergeTree on each shard)  → SHARDING demo
 *  - events_distributed  (Distributed over demo_cluster)     → SHARDING demo
 *  - events_replicated   (ReplicatedMergeTree, same ZK path) → REPLICATION demo
 *
 * Run after the cluster is healthy:
 *   node seed-cluster.js
 */
const { createClient } = require('@clickhouse/client');

const NODE1_URL = `http://${process.env.CH_NODE1_HOST || 'localhost'}:${process.env.CH_NODE1_PORT || 8124}`;
const NODE2_URL = `http://${process.env.CH_NODE2_HOST || 'localhost'}:${process.env.CH_NODE2_PORT || 8125}`;

const ch1 = createClient({ url: NODE1_URL, username: 'default', password: '', database: 'default' });
const ch2 = createClient({ url: NODE2_URL, username: 'default', password: '', database: 'default' });

const rnd = (a, b) => Math.random() * (b - a) + a;
const rndInt = (a, b) => Math.floor(rnd(a, b));
const pick = arr => arr[rndInt(0, arr.length)];
const tsAgo = (h) => new Date(Date.now() - h * 3_600_000 - rnd(0, 3_600_000))
    .toISOString().replace('T', ' ').slice(0, 19);

const SERVICES = ['frontend', 'api-gateway', 'auth-service', 'payment-service', 'ml-inference'];
const EVENT_TYPES = ['page_view', 'click', 'search', 'purchase', 'signup'];

// ─── DDL ──────────────────────────────────────────────────────────────────────
const DDL_SHARED = (ch, nodeLabel) => [
    {
        label: `[${nodeLabel}] CREATE DATABASE`,
        sql: `CREATE DATABASE IF NOT EXISTS cluster_demo`,
    },

    // SHARDING DEMO TABLE
    // Each node gets a DIFFERENT ZK path because {shard} expands to 01 or 02.
    // These act as independent shards — no replication between them.
    {
        label: `[${nodeLabel}] events_local (ReplicatedMergeTree – shard local)`,
        sql: `
      CREATE TABLE IF NOT EXISTS cluster_demo.events_local
      (
        timestamp  DateTime,
        service    LowCardinality(String),
        event_type LowCardinality(String),
        user_id    String,
        value      Float64
      )
      ENGINE = ReplicatedMergeTree(
        '/clickhouse/tables/{shard}/events_local',
        '{replica}'
      )
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (service, timestamp)
      COMMENT 'Shard-local table – each node owns its own partition'
    `,
    },

    // REPLICATION DEMO TABLE
    // BOTH nodes share the SAME ZK path → ClickHouse Keeper syncs data between them.
    // node1 has {replica}=replica-1, node2 has {replica}=replica-2.
    // Writing to node1 automatically replicates to node2!
    {
        label: `[${nodeLabel}] events_replicated (ReplicatedMergeTree – HA)`,
        sql: `
      CREATE TABLE IF NOT EXISTS cluster_demo.events_replicated
      (
        timestamp  DateTime,
        service    LowCardinality(String),
        message    String,
        severity   LowCardinality(String),
        replica    String DEFAULT getMacro('replica')
      )
      ENGINE = ReplicatedMergeTree(
        '/clickhouse/tables/ha/events_replicated',
        '{replica}'
      )
      ORDER BY (timestamp, service)
      COMMENT 'HA replication demo – same ZK path on both nodes'
    `,
    },
];

// The Distributed table is created on node1 but routes to both shards
const DDL_NODE1_ONLY = [
    {
        label: '[node1] events_distributed (Distributed engine)',
        sql: `
      CREATE TABLE IF NOT EXISTS cluster_demo.events_distributed
      AS cluster_demo.events_local
      ENGINE = Distributed(
        demo_cluster,       -- cluster name from cluster.xml
        cluster_demo,       -- database
        events_local,       -- local table on each shard
        murmurHash3_32(user_id)  -- sharding key → same user always goes to same shard
      )
      COMMENT 'Distributed table – automatically fans out reads/writes across shards'
    `,
    },
];

// ─── Data Generation ──────────────────────────────────────────────────────────
async function seedShardingData() {
    console.log('\n  📊 Inserting 8,000 rows via Distributed table (both shards)…');
    const rows = [];
    for (let i = 0; i < 8000; i++) {
        rows.push({
            timestamp: tsAgo(rnd(0, 48)),
            service: pick(SERVICES),
            event_type: pick(EVENT_TYPES),
            user_id: `user-${rndInt(1, 500)}`,
            value: parseFloat(rnd(0.1, 100).toFixed(4)),
        });
    }
    // Insert via node1's Distributed table — rows automatically route to shard 1 or 2
    await ch1.insert({
        table: 'cluster_demo.events_distributed',
        values: rows,
        format: 'JSONEachRow',
    });
    console.log('  ✅ 8,000 rows distributed across shards');
}

async function seedReplicationData() {
    console.log('\n  🔄 Inserting 200 rows into node1 (replication demo)…');
    const rows = [];
    for (let i = 0; i < 200; i++) {
        rows.push({
            timestamp: tsAgo(rnd(0, 2)),
            service: pick(SERVICES),
            message: `Event ${i} written to node1 – will replicate to node2!`,
            severity: pick(['INFO', 'WARN', 'ERROR']),
            replica: 'replica-1',
        });
    }
    await ch1.insert({
        table: 'cluster_demo.events_replicated',
        values: rows,
        format: 'JSONEachRow',
    });
    console.log('  ✅ 200 rows inserted into node1 (replica-1)');
    console.log('  ⏳ Waiting 3s for replication to node2 (replica-2)…');
    await new Promise(r => setTimeout(r, 3000));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🔧 Running cluster DDL…');
    for (const ddl of DDL_SHARED(ch1, 'node1')) {
        process.stdout.write(`  ${ddl.label}… `);
        await ch1.command({ query: ddl.sql });
        console.log('✓');
    }
    for (const ddl of DDL_SHARED(ch2, 'node2')) {
        process.stdout.write(`  ${ddl.label}… `);
        await ch2.command({ query: ddl.sql });
        console.log('✓');
    }
    for (const ddl of DDL_NODE1_ONLY) {
        process.stdout.write(`  ${ddl.label}… `);
        await ch1.command({ query: ddl.sql });
        console.log('✓');
    }

    console.log('\n🌱 Seeding cluster demo data…');
    await seedShardingData();
    await seedReplicationData();

    // Verify replication
    const r = await ch2.query({
        query: `SELECT count() AS cnt FROM cluster_demo.events_replicated`,
        format: 'JSONEachRow',
    });
    const rows = await r.json();
    const cnt = rows[0]?.cnt || 0;
    if (Number(cnt) > 0) {
        console.log(`  ✅ Replication verified: node2 (replica-2) has ${cnt} rows synced from node1!\n`);
    } else {
        console.log('  ⚠️  Replication may still be in progress — check node2 in a moment.\n');
    }

    console.log('🎉 Cluster seeding complete!\n');
    await ch1.close();
    await ch2.close();
}

main().catch(e => { console.error(e); process.exit(1); });
