/**
 * ai.js — ClickHouse AI Integration Layer
 *
 * This file implements three AI patterns on top of ClickHouse:
 *   1. Text-to-SQL  — Convert natural language questions to SQL queries
 *   2. AI Insights  — Autonomous agent that reads data and surfaces anomalies
 *   3. RAG          — Retrieval Augmented Generation using ClickHouse as vector store
 *
 * LLM: Ollama (local, no API key needed)
 *   - llama3.2        → chat, SQL generation, summaries
 *   - nomic-embed-text → text embeddings for RAG
 *
 * Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

const { createClient } = require('@clickhouse/client');

// ─── Ollama client (no SDK needed — it's just HTTP) ──────────────────────────
const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';

/**
 * Call Ollama's /api/chat endpoint.
 * This is the core function that all AI features use.
 *
 * @param {string} model    - Which model to use (e.g. 'llama3.2')
 * @param {Array}  messages - Array of {role, content} chat messages
 * @param {object} options  - Extra options (temperature, etc.)
 * @returns {Promise<string>} The model's response text
 */
async function ollamaChat(model, messages, options = {}) {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages,
            stream: false,          // We want the full response, not a stream
            options: {
                temperature: options.temperature ?? 0.1,  // Low temp = more deterministic SQL
                num_predict: options.maxTokens ?? 1024,
            },
        }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
    const data = await response.json();
    return data.message.content;
}

/**
 * Call Ollama's /api/embeddings endpoint.
 * Converts text into a Float32 vector for RAG.
 *
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} A vector of ~768 floats
 */
async function ollamaEmbed(text) {
    const response = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'nomic-embed-text',   // 274MB embedding model
            prompt: text,
        }),
    });
    if (!response.ok) throw new Error(`Ollama embed error: ${response.statusText}`);
    const data = await response.json();
    return data.embedding;           // Returns number[] of length 768
}

// ─── ClickHouse client ────────────────────────────────────────────────────────
const ch = createClient({
    url: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 8123}`,
    database: process.env.CLICKHOUSE_DB || 'demo',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    clickhouse_settings: { max_execution_time: 30 },
});

/**
 * Run a SQL query safely and return rows as JSON array.
 * Strips markdown code blocks if the LLM wraps SQL in them.
 */
async function runQuery(sql) {
    // Strip ```sql ... ``` if LLM adds markdown formatting
    const cleanSql = sql
        .replace(/```sql\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

    const result = await ch.query({ query: cleanSql, format: 'JSONEachRow' });
    return result.json();
}

// ════════════════════════════════════════════════════════════════════════════
// J1 — TEXT-TO-SQL PIPELINE
// ════════════════════════════════════════════════════════════════════════════
/**
 * The schema we inject into every Text-to-SQL prompt.
 * Giving the LLM the table structures is called "schema injection" —
 * it's how the LLM knows what tables and columns exist.
 */
const CLICKHOUSE_SCHEMA = `
You are a ClickHouse SQL expert. Generate ONLY a valid SQL SELECT query, no explanation.

Available tables in database "demo" with EXACT column names:

TABLE: demo.telemetry_events
  timestamp   DateTime       -- when the event happened
  service     LowCardinality(String) -- frontend, api-gateway, auth-service, payment-service, ml-inference, data-pipeline, notification-service
  event_type  LowCardinality(String) -- page_view, click, search, signup, purchase, api_call, error
  user_id     String         -- unique user identifier
  properties  String         -- JSON blob
  duration_ms UInt32         -- milliseconds

TABLE: demo.app_logs
  timestamp   DateTime
  level       LowCardinality(String)  -- DEBUG, INFO, WARN, ERROR
  service     LowCardinality(String)
  host        LowCardinality(String)
  message     String
  trace_id    String
  duration_ms UInt32

TABLE: demo.cost_usage
  timestamp   DateTime
  service     LowCardinality(String)
  team        LowCardinality(String)  -- infra, product, ml-team, platform
  cost_usd    Float64
  tokens_used UInt64
  api_calls   UInt32

TABLE: demo.error_summary   (ReplacingMergeTree — use FINAL or max(version) for deduplication)
  date        Date
  service     LowCardinality(String)
  error_msg   String         -- IMPORTANT: column is error_msg NOT error_message or message
  count       UInt32
  version     UInt64

TABLE: demo.budget_limits   (CollapsingMergeTree — use sum(budget_usd * sign) for net value)
  date        Date
  team        LowCardinality(String)
  budget_usd  Float64        -- IMPORTANT: column is budget_usd NOT limit_usd or budget
  sign        Int8           -- +1 = set, -1 = cancel

ClickHouse RULES (follow strictly):
- Use count() not COUNT(*)
- Use uniq(col) for approximate distinct counts
- Use quantile(0.95)(col) for P95
- Use now() for current time, today() for current date
- Time filter: WHERE timestamp >= now() - INTERVAL 24 HOUR
- Partition filter by date: WHERE toDate(timestamp) = today()
- NEVER use columns that don't exist in the schema above
`.trim();

/**
 * TEXT-TO-SQL: Convert a natural language question to SQL and run it.
 *
 * The pipeline:
 *   1. Inject schema into the prompt (so LLM knows what tables exist)
 *   2. Ask LLM to generate SQL
 *   3. Validate (SELECT only) + run on ClickHouse
 *   4. If SQL fails → SELF-CORRECTION LOOP: feed the error back to the LLM
 *   5. Summarize results in plain English
 *
 * The self-correction loop is a KEY AI ENGINEERING PATTERN — the LLM
 * uses the error message as feedback to fix its own mistakes.
 *
 * @param {string} question - e.g. "Which service had the most errors yesterday?"
 * @returns {object} { sql, rows, answer, rowCount, attempts }
 */
async function textToSQL(question) {
    const messages = [
        {
            role: 'system',
            content: CLICKHOUSE_SCHEMA,
        },
        {
            role: 'user',
            content: `Example:
Question: How many events happened in the last 24 hours?
SQL: SELECT count() AS total_events FROM demo.telemetry_events WHERE timestamp >= now() - INTERVAL 24 HOUR

Example:
Question: Which service has the highest error rate?
SQL: SELECT service, countIf(level = 'ERROR') AS errors, count() AS total, round(countIf(level='ERROR')/count()*100,2) AS error_pct FROM demo.app_logs WHERE timestamp >= now() - INTERVAL 24 HOUR GROUP BY service ORDER BY error_pct DESC LIMIT 5

Now generate ONLY a SQL query for:
Question: ${question}
SQL:`,
        },
    ];

    let sql = '';
    let rows = [];
    let lastError = '';
    const MAX_RETRIES = 3;

    // Self-correction loop: try up to 3 times
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const sqlResponse = await ollamaChat('llama3.2', messages, { temperature: 0.0 });
        sql = sqlResponse.trim().replace(/^SQL:\s*/i, '').split('\n')[0].trim();

        // Safety check
        if (!sql.toUpperCase().startsWith('SELECT')) {
            throw new Error(`Generated SQL is not a SELECT query: ${sql}`);
        }

        try {
            rows = await runQuery(sql);
            // Success! Break out of the retry loop
            break;
        } catch (err) {
            lastError = err.message;

            if (attempt === MAX_RETRIES) {
                throw new Error(`SQL failed after ${MAX_RETRIES} attempts. Last error: ${lastError}\nLast SQL: ${sql}`);
            }

            // KEY PATTERN: Feed the error back so the LLM can self-correct
            // This is exactly how tools like GitHub Copilot and Claude fix their mistakes
            messages.push(
                { role: 'assistant', content: sql },
                {
                    role: 'user',
                    content: `That SQL failed with error: "${lastError}"
The exact column names available are listed in your schema. Fix the SQL using ONLY columns that exist.
Return ONLY the corrected SQL:`,
                }
            );
        }
    }

    // Summarize results in plain English
    const answer = await ollamaChat('llama3.2', [
        {
            role: 'system',
            content: 'You are a data analyst. Summarize query results in 1-3 clear sentences with specific numbers.',
        },
        {
            role: 'user',
            content: `Question: "${question}"
SQL: ${sql}
Results: ${JSON.stringify(rows.slice(0, 10))}

Answer in plain English:`,
        },
    ], { temperature: 0.3 });

    return {
        sql,
        rows: rows.slice(0, 50),
        rowCount: rows.length,
        answer: answer.trim(),
    };
}

// ════════════════════════════════════════════════════════════════════════════
// J2 — AI INSIGHTS AGENT
// ════════════════════════════════════════════════════════════════════════════
/**
 * An "agent" is just a loop:
 *   1. Decide what data to look at
 *   2. Run a query (tool call)
 *   3. Look at the result
 *   4. Decide if more data is needed
 *   5. Repeat until enough context, then generate the final insight
 *
 * Here we implement a simplified agent that runs a fixed set of
 * diagnostic queries and then asks the LLM to find patterns.
 *
 * @param {string} section - Which section to analyze: 'telemetry'|'logging'|'costs'|'all'
 * @returns {object[]} Array of insight objects { severity, title, detail, query }
 */
async function generateInsights(section = 'all') {
    // Step 1: Agent decides what data to gather (tool calls)
    // In a full agentic system, the LLM would decide which tools to call.
    // Here we show a structured version for clarity.
    const dataGathered = {};

    if (section === 'all' || section === 'telemetry') {
        // Tool: get telemetry summary
        const rows = await runQuery(`
      SELECT
        service,
        count()                       AS total_events,
        uniq(user_id)                 AS unique_users,
        countIf(event_type = 'error') AS errors,
        round(avg(duration_ms))       AS avg_duration_ms,
        quantile(0.95)(duration_ms)   AS p95_ms
      FROM demo.telemetry_events
      WHERE timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY service
      ORDER BY total_events DESC
    `);
        dataGathered.telemetry = rows;
    }

    if (section === 'all' || section === 'logging') {
        // Tool: get log error rates
        const rows = await runQuery(`
      SELECT
        service,
        countIf(level = 'ERROR')  AS errors,
        countIf(level = 'WARN')   AS warnings,
        count()                   AS total,
        round(countIf(level = 'ERROR') / count() * 100, 2) AS error_pct
      FROM demo.app_logs
      WHERE timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY service
      ORDER BY error_pct DESC
    `);
        dataGathered.logs = rows;
    }

    if (section === 'all' || section === 'costs') {
        // Tool: get cost anomalies
        const rows = await runQuery(`
      SELECT
        service,
        team,
        round(sum(cost_usd), 2)                             AS today_cost,
        round(sum(tokens_used) / sum(api_calls), 0)         AS avg_tokens_per_call
      FROM demo.cost_usage
      WHERE toDate(timestamp) = today()
      GROUP BY service, team
      ORDER BY today_cost DESC
      LIMIT 10
    `);
        dataGathered.costs = rows;
    }

    // Step 2: Ask the LLM to analyze all gathered data and produce insights
    const insightResponse = await ollamaChat('llama3.2', [
        {
            role: 'system',
            content: `You are a senior data analyst reviewing operational metrics.
Analyze the provided data and return a JSON array of insights.
Each insight must have:
  - severity: "critical" | "warning" | "info"
  - title: short title (max 8 words)
  - detail: 1-2 sentence explanation with specific numbers from the data
  - recommendation: one actionable next step

Return ONLY valid JSON, no markdown, no explanation.`,
        },
        {
            role: 'user',
            content: `Analyze this operational data and find the most important insights:

${JSON.stringify(dataGathered, null, 2)}

Return a JSON array of 3-5 insights ordered by importance:`,
        },
    ], { temperature: 0.2, maxTokens: 1500 });

    // Step 3: Parse the LLM's JSON response
    try {
        // Extract JSON from response (LLM sometimes adds surrounding text)
        const jsonMatch = insightResponse.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array in response');
        return JSON.parse(jsonMatch[0]);
    } catch {
        // Fallback if JSON parsing fails
        return [{
            severity: 'info',
            title: 'AI Analysis Complete',
            detail: insightResponse.slice(0, 300),
            recommendation: 'Review the raw data in the SQL Playground for details.',
        }];
    }
}

// ════════════════════════════════════════════════════════════════════════════
// J3 — RAG (RETRIEVAL AUGMENTED GENERATION)
// ════════════════════════════════════════════════════════════════════════════
/**
 * RAG = "don't put everything in the prompt, only retrieve what's relevant"
 *
 * Pipeline:
 *   INDEX TIME:  text chunks → embed → store Float32[] in ClickHouse
 *   QUERY TIME:  question → embed → cosineDistance search → top-K chunks → LLM
 *
 * ClickHouse as vector store:
 *   - Stores embeddings as Array(Float32)
 *   - Uses cosineDistance() for similarity search
 *   - No separate vector DB needed!
 */

/**
 * Set up the embeddings table in ClickHouse.
 * Called once on startup.
 */
async function initRAGTable() {
    await ch.query({
        query: `
      CREATE TABLE IF NOT EXISTS demo.knowledge_embeddings
      (
        id          UUID DEFAULT generateUUIDv4(),
        source      LowCardinality(String),   -- where this chunk came from
        category    LowCardinality(String),   -- 'clickhouse', 'ai', 'architecture', etc.
        content     String,                   -- the raw text chunk
        embedding   Array(Float32),           -- vector from nomic-embed-text (768 dims)
        created_at  DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY (source, category, id)
    `,
    });
}

/**
 * Add a document to the knowledge base.
 * Splits it into chunks, embeds each, stores in ClickHouse.
 *
 * @param {string} source   - e.g. 'clickhouse-docs'
 * @param {string} category - e.g. 'mergetree'
 * @param {string} text     - The document text
 */
async function indexDocument(source, category, text) {
    // Chunk the text into ~400-character pieces with 50-char overlap
    // Smaller chunks = more precise retrieval
    const CHUNK_SIZE = 400;
    const OVERLAP = 50;
    const chunks = [];

    for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
        const chunk = text.slice(i, i + CHUNK_SIZE).trim();
        if (chunk.length > 50) chunks.push(chunk);  // Skip tiny chunks
    }

    // Embed each chunk and insert into ClickHouse
    const rows = [];
    for (const chunk of chunks) {
        const embedding = await ollamaEmbed(chunk);
        rows.push({ source, category, content: chunk, embedding });
    }

    await ch.insert({
        table: 'demo.knowledge_embeddings',
        values: rows,
        format: 'JSONEachRow',
    });

    return { chunksIndexed: rows.length };
}

/**
 * RAG query: find relevant knowledge and use it to answer a question.
 *
 * @param {string} question - User's question
 * @param {number} k        - Number of chunks to retrieve (default 5)
 * @returns {object} { answer, sources, retrievedChunks }
 */
async function ragQuery(question, k = 5) {
    // Step 1: Embed the question
    const questionEmbedding = await ollamaEmbed(question);

    // Step 2: Find the most similar chunks in ClickHouse
    // cosineDistance returns 0 for identical vectors, 2 for opposite vectors
    // We want the SMALLEST distance = most similar
    const vectorStr = `[${questionEmbedding.join(',')}]`;

    const retrieved = await runQuery(`
    SELECT
      source,
      category,
      content,
      cosineDistance(embedding, ${vectorStr}) AS distance
    FROM demo.knowledge_embeddings
    ORDER BY distance ASC
    LIMIT ${k}
  `);

    if (!retrieved.length) {
        return {
            answer: 'No relevant knowledge found. Please index some documents first.',
            sources: [],
            retrievedChunks: [],
        };
    }

    // Step 3: Build the context from retrieved chunks
    // This is the "augmentation" in Retrieval Augmented Generation
    const context = retrieved
        .map((r, i) => `[${i + 1}] (${r.source} / ${r.category}): ${r.content}`)
        .join('\n\n');

    // Step 4: Ask the LLM to answer based on the retrieved context
    // The LLM is GROUNDED in real data — it cannot hallucinate about what's in the docs
    const answer = await ollamaChat('llama3.2', [
        {
            role: 'system',
            content: `You are a helpful assistant. Answer questions using ONLY the provided context.
If the context doesn't contain enough information, say so clearly.
Always cite which source you used by referencing the [N] numbers.`,
        },
        {
            role: 'user',
            content: `Context from knowledge base:
${context}

Question: ${question}

Answer based on the context above:`,
        },
    ], { temperature: 0.3 });

    return {
        answer: answer.trim(),
        sources: [...new Set(retrieved.map(r => `${r.source}/${r.category}`))],
        retrievedChunks: retrieved.map(r => ({
            content: r.content.slice(0, 200) + '...',
            source: r.source,
            category: r.category,
            distance: parseFloat(r.distance).toFixed(4),
        })),
    };
}

// ─── Seed the RAG knowledge base with ClickHouse documentation chunks ─────────
const KNOWLEDGE_BASE = [
    {
        source: 'clickhouse-guide', category: 'mergetree',
        text: `MergeTree is the primary ClickHouse storage engine. Data is written in immutable parts sorted by ORDER BY key. Background merges combine small parts into larger ones. Every INSERT creates a new data part on disk. Parts within a partition are periodically merged. The ORDER BY clause defines the sparse primary index. PARTITION BY physically separates data into directories on disk. MergeTree is ideal for append-only time-series data, event logs, and high-throughput ingest. Rules: always batch inserts (1000+ rows), design ORDER BY around filter columns, use LowCardinality for low-distinct columns.`,
    },
    {
        source: 'clickhouse-guide', category: 'replication',
        text: `ReplicatedMergeTree adds automatic synchronization between nodes via ClickHouse Keeper (ZooKeeper-compatible). Every INSERT is logged to Keeper and replayed on all replicas. The ZK path must be the same on all replicas of the same shard. The {replica} macro must be unique per node. Replication is asynchronous - after INSERT is acknowledged, replicas pull from Keeper log. Check system.replicas for queue_size. A queue_size > 0 means replication lag. ClickHouse Keeper requires an odd number of nodes (1 or 3) for quorum.`,
    },
    {
        source: 'clickhouse-guide', category: 'sharding',
        text: `Sharding in ClickHouse uses the Distributed table engine. Each shard stores a horizontal slice of data on a separate node. The Distributed engine routes INSERT using a sharding key hash (e.g. murmurHash3_32(user_id)). Good sharding keys: user_id for user-centric analytics, rand() for even distribution. Bad keys: timestamp (hot-spots), low-cardinality columns (skew). The Distributed table itself stores no data - it fans out queries to all shards. demo_cluster has 2 shards: node1:8124 (shard01) and node2:8125 (shard02).`,
    },
    {
        source: 'ai-guide', category: 'text-to-sql',
        text: `Text-to-SQL converts natural language questions to SQL queries using LLMs. The pipeline: inject table schema into prompt, ask LLM to generate SQL, validate (SELECT only), run on database, summarize results. Schema injection is critical - the LLM cannot generate correct SQL without knowing what tables and columns exist. Few-shot examples in the prompt help the LLM understand the expected format. Temperature=0 gives most deterministic SQL. Always validate generated SQL before running - reject DROP, DELETE, INSERT.`,
    },
    {
        source: 'ai-guide', category: 'rag',
        text: `RAG (Retrieval Augmented Generation) grounds LLM responses in real data. Pipeline: index documents by chunking into ~400 char pieces, embed each chunk using an embedding model (nomic-embed-text produces 768-dim Float32 vectors), store vectors in a database. At query time: embed the question, find most similar chunks using cosine distance, inject retrieved chunks into the LLM prompt as context. ClickHouse can store embeddings as Array(Float32) and compute cosineDistance() natively. No separate vector database needed.`,
    },
    {
        source: 'ai-guide', category: 'agents',
        text: `AI agents are LLMs that can take actions (tool calls) and reason over multiple steps. An agent loop: observe (get data), think (what does this mean?), act (call a tool or return answer). Tool calls in Ollama use the tools parameter in the chat API. Each tool has a name, description, and input schema. The LLM decides which tool to call and with what arguments. In ClickHouse analytics, tools are SQL queries that the agent can compose and execute. Agents are useful for: anomaly detection, report generation, automated investigation.`,
    },
    {
        source: 'ai-guide', category: 'mcp',
        text: `MCP (Model Context Protocol) is an open standard for connecting AI models to external data and tools. An MCP server exposes tools (functions) that AI clients can call. The SDK (@modelcontextprotocol/sdk) provides server/client primitives. Tools are defined with name, description, and a Zod input schema. The transport layer uses STDIO for local servers or HTTP+SSE for remote. Claude Desktop, Cursor, and other MCP clients can connect to any MCP server. MCP enables AI assistants to directly query ClickHouse, read files, call APIs, without custom integrations.`,
    },
];

/**
 * Seed the RAG knowledge base on first startup.
 * Checks if already seeded to avoid duplicates.
 */
async function seedRAGKnowledge() {
    try {
        const count = await runQuery('SELECT count() AS n FROM demo.knowledge_embeddings');
        if (parseInt(count[0]?.n) > 0) {
            console.log(`📚 RAG knowledge base already seeded (${count[0].n} chunks)`);
            return;
        }
    } catch { /* table may not exist yet */ }

    await initRAGTable();
    console.log('📚 Seeding RAG knowledge base...');

    for (const doc of KNOWLEDGE_BASE) {
        await indexDocument(doc.source, doc.category, doc.text);
        process.stdout.write(`  indexed: ${doc.source}/${doc.category}\n`);
    }
    console.log('✅ RAG knowledge base ready');
}

module.exports = {
    textToSQL,
    generateInsights,
    ragQuery,
    indexDocument,
    seedRAGKnowledge,
    initRAGTable,
    ollamaChat,
    ollamaEmbed,
};
