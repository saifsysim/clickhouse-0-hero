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

// ─── SERVER START ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 ClickHouse Explorer API running on :${PORT}`));

