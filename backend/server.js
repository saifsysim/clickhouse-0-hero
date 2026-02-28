const { createClient } = require('@clickhouse/client');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ch = createClient({
  url: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 8123}`,
  database: process.env.CLICKHOUSE_DB || 'demo',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  clickhouse_settings: { max_execution_time: 60 },
});

// Cluster node clients (for sharding + replication demos)
const ch_node1 = createClient({
  url: `http://${process.env.CH_NODE1_HOST || 'localhost'}:${process.env.CH_NODE1_PORT || 8124}`,
  username: 'default', password: '',
  clickhouse_settings: { max_execution_time: 30 },
});
const ch_node2 = createClient({
  url: `http://${process.env.CH_NODE2_HOST || 'localhost'}:${process.env.CH_NODE2_PORT || 8125}`,
  username: 'default', password: '',
  clickhouse_settings: { max_execution_time: 30 },
});

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const result = await ch.query({ query: 'SELECT 1 AS ok', format: 'JSONEachRow' });
    const rows = await result.json();
    res.json({ status: 'connected', clickhouse: rows[0] });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ─── Generic Query Endpoint ──────────────────────────────────────────────────
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'sql is required' });
  try {
    const result = await ch.query({ query: sql, format: 'JSONEachRow' });
    const rows = await result.json();
    res.json({ rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Database Engines: Get All Table Info ────────────────────────────────────
app.get('/api/engines', async (req, res) => {
  const result = await ch.query({
    query: `
      SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size,
             comment
      FROM system.tables
      WHERE database = 'demo'
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });
  res.json(await result.json());
});

// ─── TELEMETRY: Insert event ──────────────────────────────────────────────────
app.post('/api/telemetry/event', async (req, res) => {
  const { service, event_type, user_id, properties = {} } = req.body;
  try {
    await ch.insert({
      table: 'telemetry_events',
      values: [{
        timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
        service: service || 'demo-service',
        event_type: event_type || 'page_view',
        user_id: user_id || 'anon',
        properties: JSON.stringify(properties),
      }],
      format: 'JSONEachRow',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── TELEMETRY: Dashboard stats ───────────────────────────────────────────────
app.get('/api/telemetry/stats', async (req, res) => {
  const { hours = 24 } = req.query;
  try {
    const [events, funnel, topServices] = await Promise.all([
      ch.query({
        query: `
          SELECT toStartOfHour(timestamp) AS hour,
                 event_type,
                 count() AS cnt
          FROM telemetry_events
          WHERE timestamp >= now() - INTERVAL ${hours} HOUR
          GROUP BY hour, event_type
          ORDER BY hour
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT event_type, count() AS cnt, uniq(user_id) AS unique_users
          FROM telemetry_events
          WHERE timestamp >= now() - INTERVAL ${hours} HOUR
          GROUP BY event_type
          ORDER BY cnt DESC
          LIMIT 10
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT service, count() AS total_events, uniq(user_id) AS unique_users
          FROM telemetry_events
          GROUP BY service
          ORDER BY total_events DESC
          LIMIT 8
        `,
        format: 'JSONEachRow',
      }),
    ]);

    res.json({
      timeline: await events.json(),
      funnel: await funnel.json(),
      topServices: await topServices.json(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── LOGGING: Query logs ──────────────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
  const { level, service, limit = 100, search = '' } = req.query;
  try {
    const conditions = ['1=1'];
    if (level && level !== 'all') conditions.push(`level = '${level}'`);
    if (service && service !== 'all') conditions.push(`service = '${service}'`);
    if (search) conditions.push(`message ILIKE '%${search}%'`);

    const result = await ch.query({
      query: `
        SELECT timestamp, level, service, host, message, trace_id, duration_ms
        FROM app_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY timestamp DESC
        LIMIT ${Math.min(Number(limit), 1000)}
      `,
      format: 'JSONEachRow',
    });
    res.json(await result.json());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── LOGGING: Summary stats ───────────────────────────────────────────────────
app.get('/api/logs/summary', async (req, res) => {
  try {
    const [levelCounts, errorRate, topErrors] = await Promise.all([
      ch.query({
        query: `
          SELECT level, count() AS cnt
          FROM app_logs
          WHERE timestamp >= now() - INTERVAL 24 HOUR
          GROUP BY level ORDER BY cnt DESC
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT toStartOfHour(timestamp) AS hour,
                 countIf(level = 'ERROR') AS errors,
                 countIf(level = 'WARN') AS warnings,
                 count() AS total
          FROM app_logs
          WHERE timestamp >= now() - INTERVAL 24 HOUR
          GROUP BY hour ORDER BY hour
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT message, count() AS occurrences, service
          FROM app_logs
          WHERE level = 'ERROR'
            AND timestamp >= now() - INTERVAL 24 HOUR
          GROUP BY message, service
          ORDER BY occurrences DESC
          LIMIT 10
        `,
        format: 'JSONEachRow',
      }),
    ]);

    res.json({
      levelCounts: await levelCounts.json(),
      errorRate: await errorRate.json(),
      topErrors: await topErrors.json(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── COST & USAGE ─────────────────────────────────────────────────────────────
app.get('/api/costs', async (req, res) => {
  const { days = 30, group_by = 'service' } = req.query;
  try {
    const [daily, byService, byTeam, alerts] = await Promise.all([
      ch.query({
        query: `
          SELECT toDate(timestamp) AS day,
                 sum(cost_usd) AS total_cost,
                 sum(tokens_used) AS total_tokens,
                 sum(api_calls) AS total_calls
          FROM cost_usage
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY day ORDER BY day
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT service,
                 sum(cost_usd) AS total_cost,
                 sum(tokens_used) AS total_tokens,
                 sum(api_calls) AS total_calls,
                 avg(cost_usd / api_calls) AS avg_cost_per_call
          FROM cost_usage
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY service ORDER BY total_cost DESC
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT team,
                 sum(cost_usd) AS total_cost,
                 sum(api_calls) AS total_calls
          FROM cost_usage
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY team ORDER BY total_cost DESC
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT service, team, sum(cost_usd) AS daily_cost
          FROM cost_usage
          WHERE toDate(timestamp) = today()
          GROUP BY service, team
          HAVING daily_cost > 50
          ORDER BY daily_cost DESC
        `,
        format: 'JSONEachRow',
      }),
    ]);

    res.json({
      daily: await daily.json(),
      byService: await byService.json(),
      byTeam: await byTeam.json(),
      alerts: await alerts.json(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── ENGINES: Specialized queries per engine ──────────────────────────────────
app.get('/api/engines/mergetree-demo', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT toDate(timestamp) AS day,
               event_type,
               uniq(user_id) AS unique_users,
               count() AS events,
               quantile(0.95)(duration_ms) AS p95_duration
        FROM telemetry_events
        GROUP BY day, event_type
        ORDER BY day DESC, events DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    });
    res.json({ engine: 'MergeTree', data: await result.json() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/engines/replicated-demo', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT level, service, count() AS cnt,
               min(timestamp) AS first_seen, max(timestamp) AS last_seen
        FROM app_logs
        GROUP BY level, service
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow',
    });
    res.json({
      engine: 'ReplicatedMergeTree (simulated)',
      note: 'In production this table would be on multiple replicas',
      data: await result.json()
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/engines/aggregating-demo', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT
          service,
          team,
          sum(cost_usd) AS total_cost,
          sum(api_calls) AS total_calls,
          round(sum(cost_usd)/sum(api_calls)*1000, 4) AS cost_per_1k_calls
        FROM cost_usage
        GROUP BY service, team
        ORDER BY total_cost DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    });
    res.json({ engine: 'AggregatingMergeTree', data: await result.json() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/engines/summing-demo', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT team, sum(cost_usd) AS budgeted, sum(api_calls) AS allocated_calls
        FROM cost_usage
        GROUP BY team
        ORDER BY budgeted DESC
      `,
      format: 'JSONEachRow',
    });
    res.json({ engine: 'SummingMergeTree', data: await result.json() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── SYSTEM INFO ──────────────────────────────────────────────────────────────
app.get('/api/system/info', async (req, res) => {
  try {
    const [version, tables, queryLog] = await Promise.all([
      ch.query({
        query: `SELECT version() AS ver, uptime() AS uptime_secs, timezone() AS tz`,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT name, engine, formatReadableSize(total_bytes) AS size,
                 total_rows, comment
          FROM system.tables
          WHERE database = 'demo'
          ORDER BY name
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT type, count() AS cnt,
                 round(avg(query_duration_ms)) AS avg_ms,
                 round(sum(read_rows)/1e6, 2) AS total_read_M_rows
          FROM system.query_log
          WHERE event_time >= now() - INTERVAL 1 HOUR
            AND type != 'QueryStart'
          GROUP BY type ORDER BY cnt DESC
        `,
        format: 'JSONEachRow',
      }),
    ]);

    res.json({
      server: (await version.json())[0],
      tables: await tables.json(),
      queryLog: await queryLog.json(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── CLUSTER: Health of both nodes ───────────────────────────────────────────
app.get('/api/cluster/health', async (req, res) => {
  const check = async (client, label, port) => {
    try {
      const r = await client.query({ query: 'SELECT version() AS ver, getMacro(\'shard\') AS shard, getMacro(\'replica\') AS replica', format: 'JSONEachRow' });
      const row = (await r.json())[0];
      return { node: label, port, status: 'up', ...row };
    } catch (e) {
      return { node: label, port, status: 'down', error: e.message };
    }
  };
  const [n1, n2] = await Promise.all([
    check(ch_node1, 'clickhouse-node1', 8124),
    check(ch_node2, 'clickhouse-node2', 8125),
  ]);
  res.json({ nodes: [n1, n2] });
});

// ─── CLUSTER: Topology from system.clusters ───────────────────────────────────
app.get('/api/cluster/topology', async (req, res) => {
  try {
    const r = await ch_node1.query({
      query: `
        SELECT cluster, shard_num, replica_num, host_name, port, is_local
        FROM system.clusters
        WHERE cluster IN ('demo_cluster','ha_cluster')
        ORDER BY cluster, shard_num, replica_num
      `,
      format: 'JSONEachRow',
    });
    res.json(await r.json());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CLUSTER: Row count per shard (sharding demo) ────────────────────────────
app.get('/api/cluster/shard-counts', async (req, res) => {
  try {
    const [n1, n2, dist] = await Promise.all([
      ch_node1.query({ query: `SELECT count() AS rows, 'node1 (shard 01)' AS node FROM cluster_demo.events_local`, format: 'JSONEachRow' }),
      ch_node2.query({ query: `SELECT count() AS rows, 'node2 (shard 02)' AS node FROM cluster_demo.events_local`, format: 'JSONEachRow' }),
      ch_node1.query({
        query: `
          SELECT service, count() AS events
          FROM cluster_demo.events_distributed
          GROUP BY service ORDER BY events DESC
        `,
        format: 'JSONEachRow',
      }),
    ]);
    res.json({
      shards: [...(await n1.json()), ...(await n2.json())],
      byService: await dist.json(),
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CLUSTER: Cross-shard query via Distributed table ────────────────────────
app.get('/api/cluster/distributed-query', async (req, res) => {
  try {
    const r = await ch_node1.query({
      query: `
        SELECT
          service,
          event_type,
          count()         AS total_events,
          uniq(user_id)   AS unique_users,
          round(avg(value), 2) AS avg_value
        FROM cluster_demo.events_distributed
        GROUP BY service, event_type
        ORDER BY total_events DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    });
    res.json({ rows: await r.json() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CLUSTER: Insert a row and check which shard it landed on ─────────────────
app.post('/api/cluster/insert-and-route', async (req, res) => {
  const { user_id = 'demo-user', service = 'frontend' } = req.body;
  const hash = parseInt(
    BigInt.asUintN(32, BigInt(
      user_id.split('').reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0)
    )).toString()
  );
  const expectedShard = (hash % 2 === 0) ? 'node2 (shard 02)' : 'node1 (shard 01)';
  try {
    await ch_node1.insert({
      table: 'cluster_demo.events_distributed',
      values: [{
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        service,
        event_type: 'demo_insert',
        user_id,
        value: Math.random() * 100,
      }],
      format: 'JSONEachRow',
    });
    // Check actual distribution
    const [c1, c2] = await Promise.all([
      ch_node1.query({ query: `SELECT count() AS rows FROM cluster_demo.events_local WHERE user_id='${user_id}'`, format: 'JSONEachRow' }),
      ch_node2.query({ query: `SELECT count() AS rows FROM cluster_demo.events_local WHERE user_id='${user_id}'`, format: 'JSONEachRow' }),
    ]);
    const shard1 = (await c1.json())[0]?.rows || 0;
    const shard2 = (await c2.json())[0]?.rows || 0;
    const actualShard = shard1 > 0 ? 'node1 (shard 01)' : 'node2 (shard 02)';
    res.json({ user_id, service, shardKey: `murmurHash3_32("${user_id}")`, expectedShard, actualShard, node1Rows: Number(shard1), node2Rows: Number(shard2) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CLUSTER: Replication verification ───────────────────────────────────────
app.get('/api/cluster/replication-status', async (req, res) => {
  try {
    const [node1Rows, node2Rows, replQueue, replInfo] = await Promise.all([
      ch_node1.query({ query: `SELECT count() AS rows, 'replica-1 (node1)' AS replica FROM cluster_demo.events_replicated`, format: 'JSONEachRow' }),
      ch_node2.query({ query: `SELECT count() AS rows, 'replica-2 (node2)' AS replica FROM cluster_demo.events_replicated`, format: 'JSONEachRow' }),
      ch_node1.query({
        query: `
          SELECT table, replica_name, queue_size, inserts_in_queue, merges_in_queue, last_queue_update
          FROM system.replicas
          WHERE database = 'cluster_demo' AND table = 'events_replicated'
        `,
        format: 'JSONEachRow',
      }),
      ch_node1.query({
        query: `
          SELECT replica_path, replica_name, total_replicas, active_replicas, queue_size
          FROM system.replicas
          WHERE database = 'cluster_demo'
          LIMIT 10
        `,
        format: 'JSONEachRow',
      }),
    ]);
    res.json({
      rowCounts: [...(await node1Rows.json()), ...(await node2Rows.json())],
      queue: await replQueue.json(),
      replicaInfo: await replInfo.json(),
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CLUSTER: Write to node1, verify on node2 (live replication proof) ────────
app.post('/api/cluster/replicate-demo', async (req, res) => {
  const msg = `Replication test at ${new Date().toISOString()}`;
  try {
    // Insert directly to node1 (not through Distributed)
    await ch_node1.insert({
      table: 'cluster_demo.events_replicated',
      values: [{ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), service: 'demo', message: msg, severity: 'INFO', replica: 'replica-1' }],
      format: 'JSONEachRow',
    });
    const before = await ch_node2.query({ query: `SELECT count() AS cnt FROM cluster_demo.events_replicated WHERE message='${msg}'`, format: 'JSONEachRow' });
    const beforeCount = (await before.json())[0]?.cnt || 0;
    await new Promise(r => setTimeout(r, 1500));
    const after = await ch_node2.query({ query: `SELECT count() AS cnt FROM cluster_demo.events_replicated WHERE message='${msg}'`, format: 'JSONEachRow' });
    const afterCount = (await after.json())[0]?.cnt || 0;
    res.json({
      inserted: msg,
      insertedOnNode: 'node1 (replica-1)',
      foundOnNode2Before: Number(beforeCount),
      foundOnNode2After: Number(afterCount),
      replicated: Number(afterCount) > 0,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── 13 MISTAKES: Live Demo Endpoints ────────────────────────────────────────

// #01 – Too Many Parts: show live part counts per table
app.get('/api/mistakes/parts', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT
          table,
          count()                              AS active_parts,
          sum(rows)                            AS total_rows,
          formatReadableSize(sum(data_compressed_bytes)) AS compressed_size,
          max(modification_time)               AS last_modified
        FROM system.parts
        WHERE active AND database = 'demo'
        GROUP BY table
        ORDER BY active_parts DESC
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    res.json({ rows, tip: 'Healthy: < 300 parts per table. Warning: > 1000. Critical: > 3000.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// #06 – Dedup Surprise: insert same block twice, prove count stays same
app.post('/api/mistakes/dedup-demo', async (req, res) => {
  try {
    const tag = `dedup-test-${Date.now()}`;
    const block = [
      { timestamp: '2024-01-01 00:00:00', service: 'dedup-demo', event_type: 'test', user_id: tag, properties: '{}', duration_ms: 1 },
      { timestamp: '2024-01-01 00:00:01', service: 'dedup-demo', event_type: 'test', user_id: tag, properties: '{}', duration_ms: 2 },
      { timestamp: '2024-01-01 00:00:02', service: 'dedup-demo', event_type: 'test', user_id: tag, properties: '{}', duration_ms: 3 },
    ];

    // Insert #1
    await ch.insert({ table: 'telemetry_events', values: block, format: 'JSONEachRow' });
    const after1 = await ch.query({
      query: `SELECT count() AS cnt FROM telemetry_events WHERE user_id = '${tag}'`,
      format: 'JSONEachRow',
    });
    const count1 = (await after1.json())[0]?.cnt;

    // Insert #2 — identical block
    await ch.insert({ table: 'telemetry_events', values: block, format: 'JSONEachRow' });
    const after2 = await ch.query({
      query: `SELECT count() AS cnt FROM telemetry_events WHERE user_id = '${tag}'`,
      format: 'JSONEachRow',
    });
    const count2 = (await after2.json())[0]?.cnt;

    // Cleanup (lightweight delete)
    await ch.command({ query: `DELETE FROM telemetry_events WHERE user_id = '${tag}'` });

    const deduplicated = Number(count1) === Number(count2);
    res.json({
      blockSize: block.length,
      countAfterInsert1: Number(count1),
      countAfterInsert2: Number(count2),
      deduplicated,
      explanation: deduplicated
        ? `ClickHouse saw the same block hash twice and silently ignored the second insert. ${count1} rows inserted once = ${count2} rows after two inserts.`
        : `Deduplication window may be disabled on this non-replicated table. Got ${count2} rows after 2 inserts of ${block.length} rows each.`,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// #07 – Primary Key: compare EXPLAIN for good vs bad column ordering
app.get('/api/mistakes/pk-explain', async (req, res) => {
  try {
    const [badExplain, goodExplain, badResult, goodResult] = await Promise.all([
      // Bad: filtering on user_id — NOT in primary key (service, event_type, timestamp)
      ch.query({
        query: `EXPLAIN indexes=1
          SELECT count() FROM telemetry_events WHERE user_id = 'user-42'`,
        format: 'JSONEachRow',
      }),
      // Good: filtering on service — IS the first column of ORDER BY
      ch.query({
        query: `EXPLAIN indexes=1
          SELECT count() FROM telemetry_events WHERE service = 'frontend'`,
        format: 'JSONEachRow',
      }),
      // Run both to get actual timing
      ch.query({
        query: `SELECT count() AS cnt FROM telemetry_events WHERE user_id = 'user-42'`,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `SELECT count() AS cnt FROM telemetry_events WHERE service = 'frontend'`,
        format: 'JSONEachRow',
      }),
    ]);
    res.json({
      bad: {
        filter: "WHERE user_id = 'user-42'  (NOT in primary key)",
        explain: await badExplain.json(),
        result: (await badResult.json())[0],
      },
      good: {
        filter: "WHERE service = 'frontend'  (1st column of ORDER BY)",
        explain: await goodExplain.json(),
        result: (await goodResult.json())[0],
      },
      primaryKey: 'ORDER BY (service, event_type, timestamp)',
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// #09 – LIMIT short-circuit: same GROUP BY LIMIT 1 with and without optimization
app.get('/api/mistakes/limit-demo', async (req, res) => {
  try {
    const t0slow = Date.now();
    const slowResult = await ch.query({
      query: `
        SELECT service, event_type, count() AS cnt
        FROM telemetry_events
        GROUP BY service, event_type
        ORDER BY service
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const slowRows = await slowResult.json();
    const slowMs = Date.now() - t0slow;

    const t0fast = Date.now();
    const fastResult = await ch.query({
      query: `
        SELECT service, event_type, count() AS cnt
        FROM telemetry_events
        GROUP BY service, event_type
        ORDER BY service
        LIMIT 1
        SETTINGS optimize_aggregation_in_order = 1
      `,
      format: 'JSONEachRow',
    });
    const fastRows = await fastResult.json();
    const fastMs = Date.now() - t0fast;

    res.json({
      slow: { ms: slowMs, row: slowRows[0], setting: 'default (optimize_aggregation_in_order = 0)' },
      fast: { ms: fastMs, row: fastRows[0], setting: 'optimize_aggregation_in_order = 1' },
      speedupMs: slowMs - fastMs,
      speedupPct: Math.round((1 - fastMs / slowMs) * 100),
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// #05 – Nullable cost: show real column sizes from system.columns
app.get('/api/mistakes/nullable-cost', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT
          table,
          name,
          type,
          data_compressed_bytes,
          data_uncompressed_bytes,
          formatReadableSize(data_compressed_bytes)   AS compressed,
          formatReadableSize(data_uncompressed_bytes) AS uncompressed,
          round(data_uncompressed_bytes / greatest(data_compressed_bytes,1), 2) AS compression_ratio
        FROM system.columns
        WHERE database = 'demo'
          AND table IN ('telemetry_events', 'app_logs', 'cost_usage')
        ORDER BY table, data_compressed_bytes DESC
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    // Categorise: Nullable types cost more storage
    const withTypes = rows.map(r => ({
      ...r,
      isNullable: r.type.startsWith('Nullable'),
      isLowCardinality: r.type.startsWith('LowCardinality'),
    }));
    res.json({
      columns: withTypes,
      tip: 'None of our demo tables use Nullable — that\'s intentional. LowCardinality columns compress dramatically better than plain String.',
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// #11 – Memory: show heaviest recent queries from system.query_log
app.get('/api/mistakes/query-memory', async (req, res) => {
  try {
    const result = await ch.query({
      query: `
        SELECT
          substring(query, 1, 80)          AS query_preview,
          round(memory_usage / 1048576, 1) AS memory_mb,
          read_rows,
          read_bytes,
          query_duration_ms,
          type
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL 10 MINUTE
          AND type = 'QueryFinish'
          AND memory_usage > 0
        ORDER BY memory_usage DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json();

    // Also run a live heavy query so there's something to show
    await ch.query({
      query: `SELECT user_id, count() AS c, uniq(service) AS u FROM telemetry_events GROUP BY user_id ORDER BY c DESC LIMIT 100`,
      format: 'JSONEachRow',
    }).then(r => r.json()).catch(() => { });

    const result2 = await ch.query({
      query: `
        SELECT
          substring(query, 1, 80)          AS query_preview,
          round(memory_usage / 1048576, 1) AS memory_mb,
          read_rows,
          formatReadableSize(read_bytes)   AS read_size,
          query_duration_ms                AS duration_ms,
          type
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL 5 MINUTE
          AND type = 'QueryFinish'
          AND memory_usage > 0
        ORDER BY memory_usage DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });

    res.json({ rows: await result2.json() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// #12 – Materialized Views: show MV status and what it captured
app.get('/api/mistakes/mv-status', async (req, res) => {
  try {
    const [mvList, aggSample, sourceSample] = await Promise.all([
      ch.query({
        query: `
          SELECT name, engine, total_rows,
                 formatReadableSize(total_bytes) AS size
          FROM system.tables
          WHERE database = 'demo'
            AND (engine LIKE '%View%' OR engine LIKE '%Aggregating%')
          ORDER BY name
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT
            service,
            event_type,
            countMerge(event_count)          AS total_events,
            uniqMerge(unique_users)           AS unique_users,
            round(quantileMerge(0.95)(p95_duration)) AS p95_ms
          FROM telemetry_hourly_agg
          GROUP BY service, event_type
          ORDER BY total_events DESC
          LIMIT 8
        `,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT service, event_type, count() AS direct_count
          FROM telemetry_events
          GROUP BY service, event_type
          ORDER BY direct_count DESC
          LIMIT 8
        `,
        format: 'JSONEachRow',
      }),
    ]);
    res.json({
      views: await mvList.json(),
      mvAggregated: await aggSample.json(),
      sourceCount: await sourceSample.json(),
      note: 'The MV only captured rows that were INSERTed after the view was created. Backfill via INSERT INTO ... SELECT from source.',
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── 13 MISTAKES v2: Wrong / Fixed / Reset endpoints ─────────────────────────

// ── #01 Too Many Parts ────────────────────────────────────────────────────────
app.post('/api/mistakes/parts-wrong', async (req, res) => {
  try {
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_parts_demo` });
    await ch.command({
      query: `
      CREATE TABLE demo.mistake_parts_demo (id UInt32, val String)
      ENGINE = MergeTree() ORDER BY id
      SETTINGS min_bytes_for_wide_part = 0, min_rows_for_wide_part = 0
    ` });
    await ch.command({ query: `SYSTEM STOP MERGES demo.mistake_parts_demo` });
    const ROWS = 15;
    const t0 = Date.now();
    for (let i = 1; i <= ROWS; i++) {
      await ch.command({ query: `INSERT INTO demo.mistake_parts_demo VALUES (${i}, 'row-${i}')` });
    }
    const elapsed = Date.now() - t0;
    const r = await ch.query({
      query: `SELECT count() AS parts, sum(rows) AS total_rows FROM system.parts WHERE active AND database='demo' AND table='mistake_parts_demo'`,
      format: 'JSONEachRow',
    });
    const s = (await r.json())[0];
    res.json({
      approach: `${ROWS} individual INSERT statements`, parts: Number(s.parts), totalRows: Number(s.total_rows), elapsedMs: elapsed,
      warning: `⚠️ ${s.parts} parts from just ${ROWS} rows! At 100k inserts/day this becomes 100,000 parts — ClickHouse will refuse further inserts.`
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/parts-fixed', async (req, res) => {
  try {
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_parts_good` });
    await ch.command({
      query: `
      CREATE TABLE demo.mistake_parts_good (id UInt32, val String)
      ENGINE = MergeTree() ORDER BY id
      SETTINGS min_bytes_for_wide_part = 0, min_rows_for_wide_part = 0
    ` });
    const ROWS = 15;
    const t0 = Date.now();
    const vals = Array.from({ length: ROWS }, (_, i) => `(${i + 1},'row-${i + 1}')`).join(',');
    await ch.command({ query: `INSERT INTO demo.mistake_parts_good VALUES ${vals}` });
    const elapsed = Date.now() - t0;
    const r = await ch.query({
      query: `SELECT count() AS parts, sum(rows) AS total_rows FROM system.parts WHERE active AND database='demo' AND table='mistake_parts_good'`,
      format: 'JSONEachRow',
    });
    const s = (await r.json())[0];
    res.json({
      approach: `1 batch INSERT — all ${ROWS} rows at once`, parts: Number(s.parts), totalRows: Number(s.total_rows), elapsedMs: elapsed,
      tip: `✅ ${s.parts} part from ${ROWS} rows. Rule: batch 10k–100k rows per INSERT. Use async_insert=1 for streaming pipelines.`
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/parts-reset', async (req, res) => {
  try {
    await ch.command({ query: `SYSTEM START MERGES demo.mistake_parts_demo` }).catch(() => { });
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_parts_demo` });
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_parts_good` });
    res.json({ ok: true, message: 'Dropped mistake_parts_demo and mistake_parts_good tables.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── #05 Nullable vs DEFAULT ───────────────────────────────────────────────────
app.post('/api/mistakes/nullable-wrong', async (req, res) => {
  try {
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_nullable_bad` });
    await ch.command({
      query: `
      CREATE TABLE demo.mistake_nullable_bad (id UInt32, email Nullable(String), country Nullable(String), age Nullable(Int32))
      ENGINE = MergeTree() ORDER BY id
    ` });
    const ROWS = 2000;
    const vals = Array.from({ length: ROWS }, (_, i) => {
      const n = i % 4 === 0;
      return `(${i + 1},${n ? 'NULL' : `'user${i}@test.com'`},${n ? 'NULL' : `'US'`},${n ? 'NULL' : (i % 60 + 18)})`;
    }).join(',');
    await ch.command({ query: `INSERT INTO demo.mistake_nullable_bad VALUES ${vals}` });
    await ch.command({ query: `OPTIMIZE TABLE demo.mistake_nullable_bad FINAL` });
    const r = await ch.query({
      query: `SELECT name, type, formatReadableSize(data_compressed_bytes) AS compressed, data_compressed_bytes AS raw_bytes FROM system.columns WHERE database='demo' AND table='mistake_nullable_bad' ORDER BY raw_bytes DESC`,
      format: 'JSONEachRow',
    });
    const tot = await ch.query({ query: `SELECT formatReadableSize(sum(data_compressed_bytes)) AS total FROM system.columns WHERE database='demo' AND table='mistake_nullable_bad'`, format: 'JSONEachRow' });
    res.json({ columns: await r.json(), totalCompressed: (await tot.json())[0].total, rows: ROWS, note: 'Each Nullable column requires a separate null-map bitmap file on disk.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/nullable-fixed', async (req, res) => {
  try {
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_nullable_good` });
    await ch.command({
      query: `
      CREATE TABLE demo.mistake_nullable_good (id UInt32, email String DEFAULT '', country LowCardinality(String) DEFAULT 'unknown', age Int32 DEFAULT 0)
      ENGINE = MergeTree() ORDER BY id
    ` });
    const ROWS = 2000;
    const vals = Array.from({ length: ROWS }, (_, i) => {
      const n = i % 4 === 0;
      return `(${i + 1},'${n ? '' : (`user${i}@test.com`)}','${n ? 'unknown' : 'US'}',${n ? 0 : (i % 60 + 18)})`;
    }).join(',');
    await ch.command({ query: `INSERT INTO demo.mistake_nullable_good VALUES ${vals}` });
    await ch.command({ query: `OPTIMIZE TABLE demo.mistake_nullable_good FINAL` });
    const r = await ch.query({
      query: `SELECT name, type, formatReadableSize(data_compressed_bytes) AS compressed, data_compressed_bytes AS raw_bytes FROM system.columns WHERE database='demo' AND table='mistake_nullable_good' ORDER BY raw_bytes DESC`,
      format: 'JSONEachRow',
    });
    const tot = await ch.query({ query: `SELECT formatReadableSize(sum(data_compressed_bytes)) AS total FROM system.columns WHERE database='demo' AND table='mistake_nullable_good'`, format: 'JSONEachRow' });
    res.json({ columns: await r.json(), totalCompressed: (await tot.json())[0].total, rows: ROWS, note: 'No null-map overhead. LowCardinality(String) compresses 3–10× better than plain String.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/nullable-reset', async (req, res) => {
  try {
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_nullable_bad` });
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_nullable_good` });
    res.json({ ok: true, message: 'Dropped mistake_nullable_bad and mistake_nullable_good.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── #06 Dedup Surprise ────────────────────────────────────────────────────────
app.post('/api/mistakes/dedup-wrong', async (req, res) => {
  try {
    const tag = `dedup-wrong-${Date.now()}`;
    const block = [
      { timestamp: '2024-06-01 10:00:00', service: 'dedup-demo', event_type: 'checkout', user_id: tag, properties: '{}', duration_ms: 10 },
      { timestamp: '2024-06-01 10:00:01', service: 'dedup-demo', event_type: 'checkout', user_id: tag, properties: '{}', duration_ms: 20 },
      { timestamp: '2024-06-01 10:00:02', service: 'dedup-demo', event_type: 'checkout', user_id: tag, properties: '{}', duration_ms: 30 },
    ];
    await ch.insert({ table: 'telemetry_events', values: block, format: 'JSONEachRow' });
    const c1 = Number(((await (await ch.query({ query: `SELECT count() AS cnt FROM telemetry_events WHERE user_id='${tag}'`, format: 'JSONEachRow' })).json())[0]?.cnt));
    await ch.insert({ table: 'telemetry_events', values: block, format: 'JSONEachRow' }); // same block again (retry)
    const c2 = Number(((await (await ch.query({ query: `SELECT count() AS cnt FROM telemetry_events WHERE user_id='${tag}'`, format: 'JSONEachRow' })).json())[0]?.cnt));
    await ch.command({ query: `DELETE FROM telemetry_events WHERE user_id='${tag}'` });
    res.json({
      blockSize: block.length, afterInsert1: c1, afterInsert2: c2, duplicated: c2 > c1,
      explanation: c2 > c1
        ? `❌ You retried the same INSERT twice. Expected ${c1} rows — got ${c2}! Deduplication only works on REPLICATED tables (ReplicatedMergeTree) with a non-zero deduplication window.`
        : `Dedup triggered (same block hash). This only works reliably with ReplicatedMergeTree.`
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/dedup-fixed', async (req, res) => {
  try {
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_dedup_good` });
    await ch.command({
      query: `
      CREATE TABLE demo.mistake_dedup_good (id UInt64, user String, payload String, ver UInt64)
      ENGINE = ReplacingMergeTree(ver) ORDER BY id
    ` });
    await ch.command({ query: `INSERT INTO demo.mistake_dedup_good VALUES (1,'alice','v1-purchase',1),(2,'bob','v1-purchase',1),(3,'carol','v1-purchase',1)` });
    await ch.command({ query: `INSERT INTO demo.mistake_dedup_good VALUES (1,'alice','v2-refund',2),(2,'bob','v2-refund',2)` }); // retry/update
    const raw = await (await ch.query({ query: `SELECT id,user,payload,ver FROM demo.mistake_dedup_good ORDER BY id,ver`, format: 'JSONEachRow' })).json();
    const deduped = await (await ch.query({ query: `SELECT id,user,payload,ver FROM demo.mistake_dedup_good FINAL ORDER BY id`, format: 'JSONEachRow' })).json();
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_dedup_good` });
    res.json({
      withoutFinal: raw, withFinal: deduped,
      tip: 'ReplacingMergeTree keeps the highest ver row per key. SELECT FINAL forces dedup now. Without FINAL, old rows appear until background merge runs.'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── #07 Primary Key ───────────────────────────────────────────────────────────
app.post('/api/mistakes/pk-wrong', async (req, res) => {
  try {
    const t0 = Date.now();
    const r = await ch.query({ query: `SELECT count() AS cnt FROM telemetry_events WHERE user_id = 'user-42'`, format: 'JSONEachRow' });
    const elapsed = Date.now() - t0;
    const ex = await ch.query({ query: `EXPLAIN indexes=1 SELECT count() FROM telemetry_events WHERE user_id = 'user-42'`, format: 'JSONEachRow' });
    res.json({
      query: `WHERE user_id = 'user-42'`, inPrimaryKey: false, resultCount: Number((await r.json())[0].cnt), elapsedMs: elapsed,
      explain: (await ex.json()).map(r => Object.values(r).join(' ')).filter(s => s.trim()),
      warning: `user_id is NOT in ORDER BY (service, event_type, timestamp). ClickHouse reads ALL granules — full table scan on ${(60000).toLocaleString()} rows.`
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/pk-fixed', async (req, res) => {
  try {
    const t0 = Date.now();
    const r = await ch.query({ query: `SELECT count() AS cnt FROM telemetry_events WHERE service = 'frontend'`, format: 'JSONEachRow' });
    const elapsed = Date.now() - t0;
    const ex = await ch.query({ query: `EXPLAIN indexes=1 SELECT count() FROM telemetry_events WHERE service = 'frontend'`, format: 'JSONEachRow' });
    res.json({
      query: `WHERE service = 'frontend'`, inPrimaryKey: true, resultCount: Number((await r.json())[0].cnt), elapsedMs: elapsed,
      explain: (await ex.json()).map(r => Object.values(r).join(' ')).filter(s => s.trim()),
      tip: `service is the FIRST column of ORDER BY. ClickHouse skips granules that can't match — reads only a fraction of the table.`
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── #09 LIMIT short-circuit ───────────────────────────────────────────────────
app.post('/api/mistakes/limit-wrong', async (req, res) => {
  try {
    const t0 = Date.now();
    const r = await ch.query({ query: `SELECT service, event_type, count() AS cnt FROM telemetry_events GROUP BY service, event_type ORDER BY service LIMIT 1`, format: 'JSONEachRow' });
    const elapsed = Date.now() - t0;
    res.json({
      setting: 'optimize_aggregation_in_order = 0 (default)', elapsedMs: elapsed, result: (await r.json())[0],
      explanation: 'ClickHouse scans ALL rows, builds the complete aggregation hash table, THEN applies LIMIT 1. LIMIT only runs at the very end.'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/limit-fixed', async (req, res) => {
  try {
    const t0 = Date.now();
    const r = await ch.query({ query: `SELECT service, event_type, count() AS cnt FROM telemetry_events GROUP BY service, event_type ORDER BY service LIMIT 1 SETTINGS optimize_aggregation_in_order = 1`, format: 'JSONEachRow' });
    const elapsed = Date.now() - t0;
    res.json({
      setting: 'optimize_aggregation_in_order = 1', elapsedMs: elapsed, result: (await r.json())[0],
      tip: 'ORDER BY matches the table ORDER BY, so ClickHouse stops after filling 1 bucket. Dramatic speedup at scale (millions of rows).'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── #11 Memory Limits ─────────────────────────────────────────────────────────
app.post('/api/mistakes/memory-wrong', async (req, res) => {
  try {
    const t0 = Date.now();
    await ch.query({ query: `SELECT user_id, count() AS c, groupArray(5)(service) AS svcs FROM telemetry_events GROUP BY user_id ORDER BY c DESC LIMIT 10`, format: 'JSONEachRow' }).then(r => r.json());
    const elapsed = Date.now() - t0;
    const log = await ch.query({ query: `SELECT round(memory_usage/1048576,2) AS mb, read_rows, query_duration_ms FROM system.query_log WHERE event_time >= now() - INTERVAL 30 SECOND AND type='QueryFinish' AND position(query,'groupArray')>0 ORDER BY event_time DESC LIMIT 1`, format: 'JSONEachRow' });
    res.json({
      setting: 'No memory limits set', elapsedMs: elapsed, queryLog: (await log.json())[0] || null,
      warning: 'No guard rails: GROUP BY with groupArray() builds an in-memory array per key. On a table with millions of unique keys this OOMs ClickHouse.'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/memory-fixed', async (req, res) => {
  try {
    const t0 = Date.now();
    await ch.query({ query: `SELECT user_id, count() AS c, groupArray(5)(service) AS svcs FROM telemetry_events GROUP BY user_id ORDER BY c DESC LIMIT 10 SETTINGS max_bytes_before_external_group_by=100000000, max_memory_usage=500000000`, format: 'JSONEachRow' }).then(r => r.json());
    const elapsed = Date.now() - t0;
    const log = await ch.query({ query: `SELECT round(memory_usage/1048576,2) AS mb, read_rows, query_duration_ms FROM system.query_log WHERE event_time >= now() - INTERVAL 30 SECOND AND type='QueryFinish' AND position(query,'max_bytes_before_external_group_by')>0 ORDER BY event_time DESC LIMIT 1`, format: 'JSONEachRow' });
    res.json({
      setting: 'max_bytes_before_external_group_by=100MB + max_memory_usage=500MB', elapsedMs: elapsed, queryLog: (await log.json())[0] || null,
      tip: 'When GROUP BY state exceeds 100MB, ClickHouse spills to disk instead of OOMing. Add max_memory_usage as a hard safety cap per query.'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── #12 Materialized Views ────────────────────────────────────────────────────
app.post('/api/mistakes/mv-wrong', async (req, res) => {
  try {
    await ch.command({ query: `DROP VIEW IF EXISTS demo.mistake_mv_demo` });
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_mv_target` });
    await ch.command({ query: `CREATE TABLE demo.mistake_mv_target (service String, total UInt64) ENGINE = SummingMergeTree() ORDER BY service` });
    await ch.command({ query: `CREATE MATERIALIZED VIEW demo.mistake_mv_demo TO demo.mistake_mv_target AS SELECT service, count() AS total FROM telemetry_events GROUP BY service` });
    const target = await ch.query({ query: `SELECT count() AS rows, sum(total) AS events FROM demo.mistake_mv_target`, format: 'JSONEachRow' });
    const source = await ch.query({ query: `SELECT count() AS rows FROM telemetry_events`, format: 'JSONEachRow' });
    const t = (await target.json())[0]; const s = (await source.json())[0];
    res.json({
      mvCreated: true, sourceRows: Number(s.rows), mvRows: Number(t.rows), mvEventSum: Number(t.events || 0),
      problem: `The MV was created AFTER ${Number(s.rows).toLocaleString()} rows already existed in telemetry_events. It captured 0 of them! MVs only process new INSERT blocks going forward.`
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/mv-fixed', async (req, res) => {
  try {
    await ch.command({ query: `INSERT INTO demo.mistake_mv_target SELECT service, count() AS total FROM telemetry_events GROUP BY service` });
    const r = await ch.query({ query: `SELECT service, sum(total) AS total FROM demo.mistake_mv_target GROUP BY service ORDER BY total DESC LIMIT 8`, format: 'JSONEachRow' });
    const tot = await ch.query({ query: `SELECT sum(total) AS grand_total FROM demo.mistake_mv_target`, format: 'JSONEachRow' });
    res.json({
      backfilled: true, rows: await r.json(), grandTotal: Number((await tot.json())[0].grand_total),
      tip: 'Backfill pattern: INSERT INTO mv_target SELECT ... FROM source WHERE [date range]. Now the MV has historical + all future data.'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mistakes/mv-reset', async (req, res) => {
  try {
    await ch.command({ query: `DROP VIEW IF EXISTS demo.mistake_mv_demo` });
    await ch.command({ query: `DROP TABLE IF EXISTS demo.mistake_mv_target` });
    res.json({ ok: true, message: 'Dropped mistake_mv_demo view and mistake_mv_target table. Ready to run again.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── SERVER START ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 ClickHouse Explorer API running on :${PORT}`));

