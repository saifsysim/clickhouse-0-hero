/**
 * mcp-server.js — ClickHouse MCP Server
 *
 * MCP = Model Context Protocol (open standard by Anthropic)
 * https://modelcontextprotocol.io/
 *
 * This server exposes ClickHouse data as "tools" that any MCP-compatible
 * AI client can call. Tested with Claude Desktop, Cursor AI.
 *
 * LEARNING GOAL:
 *   Understand how AI assistants call external tools, how tool schemas work,
 *   and how to build a production-grade MCP server from scratch.
 *
 * HOW TO CONNECT TO CLAUDE DESKTOP:
 *   Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "clickhouse": {
 *         "command": "node",
 *         "args": ["/path/to/mcp-server.js"]
 *       }
 *     }
 *   }
 *
 * HOW TO RUN STANDALONE:
 *   node mcp-server.js
 *   (communicates via STDIO — pipe input/output)
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError,
} = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const { createClient } = require('@clickhouse/client');

// ─── ClickHouse connection ────────────────────────────────────────────────────
const ch = createClient({
    url: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 8123}`,
    database: process.env.CLICKHOUSE_DB || 'demo',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
});

async function runQuery(sql) {
    const result = await ch.query({ query: sql, format: 'JSONEachRow' });
    return result.json();
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────
/**
 * Create the MCP server with name and version.
 * The AI client uses these for display.
 */
const server = new Server(
    { name: 'clickhouse-explorer', version: '1.0.0' },
    { capabilities: { tools: {} } }  // We expose "tools" capability
);

// ─── Tool: list_tables ────────────────────────────────────────────────────────
/**
 * LEARNING: Every MCP tool needs:
 *   1. name        — how the AI calls it
 *   2. description — what it does (the AI reads this to decide when to use it)
 *   3. inputSchema — JSON Schema for the tool's parameters
 *   4. handler     — the actual code that runs when the AI calls it
 */

/** Handler: ListTools — returns the catalog of all available tools */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'list_tables',
            description: 'List all tables in the ClickHouse demo database with their row counts and sizes.',
            inputSchema: {
                type: 'object',
                properties: {},  // No parameters needed
                required: [],
            },
        },
        {
            name: 'get_schema',
            description: 'Get the column definitions for a specific ClickHouse table.',
            inputSchema: {
                type: 'object',
                properties: {
                    table: {
                        type: 'string',
                        description: 'Table name (e.g. telemetry_events, app_logs, cost_usage)',
                    },
                },
                required: ['table'],
            },
        },
        {
            name: 'query_clickhouse',
            description: 'Execute a SELECT SQL query on ClickHouse and return results as JSON. Only SELECT queries are allowed.',
            inputSchema: {
                type: 'object',
                properties: {
                    sql: {
                        type: 'string',
                        description: 'A valid ClickHouse SELECT query',
                    },
                },
                required: ['sql'],
            },
        },
        {
            name: 'get_telemetry_summary',
            description: 'Get a summary of telemetry events for the last N hours, grouped by service and event type.',
            inputSchema: {
                type: 'object',
                properties: {
                    hours: {
                        type: 'number',
                        description: 'Number of hours to look back (default: 24)',
                    },
                },
                required: [],
            },
        },
        {
            name: 'get_top_errors',
            description: 'Get the most frequent error log messages in the last N hours.',
            inputSchema: {
                type: 'object',
                properties: {
                    hours: {
                        type: 'number',
                        description: 'Number of hours to look back (default: 24)',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results (default: 10)',
                    },
                },
                required: [],
            },
        },
        {
            name: 'get_cost_breakdown',
            description: 'Get API cost breakdown by service and team for the last N days.',
            inputSchema: {
                type: 'object',
                properties: {
                    days: {
                        type: 'number',
                        description: 'Number of days to look back (default: 7)',
                    },
                },
                required: [],
            },
        },
        {
            name: 'get_latency_stats',
            description: 'Get P50/P95/P99 latency statistics per service from telemetry events.',
            inputSchema: {
                type: 'object',
                properties: {
                    hours: {
                        type: 'number',
                        description: 'Number of hours to look back (default: 24)',
                    },
                },
                required: [],
            },
        },
        {
            name: 'get_cluster_status',
            description: 'Check the status of the ClickHouse cluster nodes and replication health.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────────
/**
 * Handler: CallTool — runs when the AI decides to call one of our tools.
 * The AI sends { name: "tool_name", arguments: { ...params } }
 * We return { content: [{ type: "text", text: "..." }] }
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {

            // ── list_tables ─────────────────────────────────────────────────────────
            case 'list_tables': {
                const rows = await runQuery(`
          SELECT
            name AS table_name,
            engine,
            total_rows,
            formatReadableSize(total_bytes) AS size,
            ttl_expression
          FROM system.tables
          WHERE database = 'demo'
          ORDER BY total_bytes DESC
        `);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(rows, null, 2),
                    }],
                };
            }

            // ── get_schema ──────────────────────────────────────────────────────────
            case 'get_schema': {
                // Validate input using Zod schema
                const { table } = z.object({ table: z.string() }).parse(args);
                const rows = await runQuery(`
          SELECT name, type, default_expression, comment
          FROM system.columns
          WHERE database = 'demo' AND table = '${table.replace(/'/g, '')}'
          ORDER BY position
        `);
                if (!rows.length) throw new McpError(ErrorCode.InvalidParams, `Table '${table}' not found`);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(rows, null, 2),
                    }],
                };
            }

            // ── query_clickhouse ────────────────────────────────────────────────────
            case 'query_clickhouse': {
                const { sql } = z.object({ sql: z.string() }).parse(args);

                // Safety: only allow SELECT queries
                if (!sql.trim().toUpperCase().startsWith('SELECT')) {
                    throw new McpError(
                        ErrorCode.InvalidParams,
                        'Only SELECT queries are allowed for safety. Got: ' + sql.slice(0, 50)
                    );
                }

                const rows = await runQuery(sql);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(rows.slice(0, 100), null, 2),   // cap at 100 rows
                    }],
                };
            }

            // ── get_telemetry_summary ───────────────────────────────────────────────
            case 'get_telemetry_summary': {
                const hours = args?.hours ?? 24;
                const rows = await runQuery(`
          SELECT
            service,
            event_type,
            count()                     AS events,
            uniq(user_id)               AS unique_users,
            round(avg(duration_ms))     AS avg_ms,
            quantile(0.95)(duration_ms) AS p95_ms
          FROM demo.telemetry_events
          WHERE timestamp >= now() - INTERVAL ${hours} HOUR
          GROUP BY service, event_type
          ORDER BY events DESC
          LIMIT 20
        `);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ period_hours: hours, data: rows }, null, 2),
                    }],
                };
            }

            // ── get_top_errors ──────────────────────────────────────────────────────
            case 'get_top_errors': {
                const hours = args?.hours ?? 24;
                const limit = args?.limit ?? 10;
                const rows = await runQuery(`
          SELECT
            service,
            message,
            count() AS occurrences,
            max(timestamp) AS last_seen
          FROM demo.app_logs
          WHERE level = 'ERROR'
            AND timestamp >= now() - INTERVAL ${hours} HOUR
          GROUP BY service, message
          ORDER BY occurrences DESC
          LIMIT ${limit}
        `);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ period_hours: hours, top_errors: rows }, null, 2),
                    }],
                };
            }

            // ── get_cost_breakdown ──────────────────────────────────────────────────
            case 'get_cost_breakdown': {
                const days = args?.days ?? 7;
                const rows = await runQuery(`
          SELECT
            service,
            team,
            round(sum(cost_usd), 4)    AS total_cost_usd,
            sum(tokens_used)           AS total_tokens,
            sum(api_calls)             AS total_api_calls,
            round(sum(cost_usd) / sum(api_calls) * 1000, 4) AS cost_per_1k_calls
          FROM demo.cost_usage
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY service, team
          ORDER BY total_cost_usd DESC
        `);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ period_days: days, breakdown: rows }, null, 2),
                    }],
                };
            }

            // ── get_latency_stats ───────────────────────────────────────────────────
            case 'get_latency_stats': {
                const hours = args?.hours ?? 24;
                const rows = await runQuery(`
          SELECT
            service,
            quantile(0.50)(duration_ms) AS p50_ms,
            quantile(0.95)(duration_ms) AS p95_ms,
            quantile(0.99)(duration_ms) AS p99_ms,
            round(avg(duration_ms))     AS avg_ms,
            count()                     AS total_requests
          FROM demo.telemetry_events
          WHERE timestamp >= now() - INTERVAL ${hours} HOUR
          GROUP BY service
          ORDER BY p95_ms DESC
        `);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ period_hours: hours, latency: rows }, null, 2),
                    }],
                };
            }

            // ── get_cluster_status ──────────────────────────────────────────────────
            case 'get_cluster_status': {
                // Check both cluster topology and replication health
                let topology = [], replication = [];
                try {
                    topology = await runQuery(`
            SELECT cluster, shard_num, replica_num, host_name, port
            FROM system.clusters
            WHERE cluster IN ('demo_cluster', 'ha_cluster')
            ORDER BY cluster, shard_num
          `);
                } catch { topology = [{ error: 'Could not reach cluster nodes' }]; }

                try {
                    replication = await runQuery(`
            SELECT table, replica_name, total_replicas, active_replicas, queue_size
            FROM system.replicas
            WHERE database = 'cluster_demo'
          `);
                } catch { replication = []; }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ topology, replication }, null, 2),
                    }],
                };
            }

            // ── Unknown tool ────────────────────────────────────────────────────────
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
    } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(ErrorCode.InternalError, `Tool error: ${error.message}`);
    }
});

// ─── Start the MCP server ─────────────────────────────────────────────────────
/**
 * STDIO transport: MCP clients communicate with this server via stdin/stdout.
 * The client starts this process and sends JSON-RPC messages over the pipe.
 *
 * This is how Claude Desktop, Cursor, and other clients connect.
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Note: don't use console.log here — it goes to stdout and breaks the MCP protocol
    // MCP uses stdout for protocol messages ONLY. Log to stderr.
    process.stderr.write('ClickHouse MCP Server running (STDIO transport)\n');
    process.stderr.write('Tools available: list_tables, get_schema, query_clickhouse,\n');
    process.stderr.write('  get_telemetry_summary, get_top_errors, get_cost_breakdown,\n');
    process.stderr.write('  get_latency_stats, get_cluster_status\n');
}

main().catch((err) => {
    process.stderr.write(`MCP Server failed: ${err.message}\n`);
    process.exit(1);
});
