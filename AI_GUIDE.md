# Module J — AI Engineering on ClickHouse
### A Zero-to-Hero Guide for Learners

> **Branch:** `addAI`  
> **Prerequisites:** Complete the ClickHouse fundamentals first (`main` branch).  
> **Goal:** Build four real AI systems from scratch — no black boxes, no magic libraries.

---

## 📖 Table of Contents

1. [Why AI + ClickHouse?](#why-ai--clickhouse)
2. [Environment Setup](#environment-setup)
3. [J1 — Text-to-SQL Chatbot](#j1--text-to-sql-chatbot)
4. [J2 — AI Insights Agent](#j2--ai-insights-agent)
5. [J3 — RAG with ClickHouse as Vector Store](#j3--rag-with-clickhouse-as-vector-store)
6. [J4 — MCP Server (Connect AI to Claude/Cursor)](#j4--mcp-server)
7. [Key Patterns Reference](#key-patterns-reference)
8. [Common Problems & Fixes](#common-problems--fixes)

---

## Why AI + ClickHouse?

Most AI tutorials use toy data. ClickHouse gives you a **real, production-grade database** to build AI on top of. This teaches you:

| What you learn | Why it matters |
|---------------|----------------|
| Schema injection into prompts | LLMs don't know your tables — you have to tell them |
| Self-correcting SQL loops | LLMs make mistakes — agents fix themselves |
| Embeddings stored in ClickHouse | You don't need Pinecone — any DB that stores arrays works |
| MCP protocol from scratch | Understanding how Claude/Cursor calls your tools |

**The stack we use — intentionally minimal:**

```
Ollama (local LLM)          ← no API key, no cost, runs on your GPU/CPU
  ├── llama3.2              ← for chat, SQL generation, summarization
  └── nomic-embed-text      ← for RAG embeddings (768-dimensional vectors)

ClickHouse                  ← data + vector store (no Pinecone needed!)
Node.js + Express           ← API layer
Vanilla JS frontend         ← UI (no React, easier to read)
```

> **Why Ollama instead of OpenAI?**  
> Privacy, zero cost, and you _own_ the model. The patterns you learn work with any LLM — swap Ollama for OpenAI by changing one URL and adding an API key.

---

## Environment Setup

### Step 1 — Install Ollama

```bash
# Mac
curl -fsSL https://ollama.ai/install.sh | sh

# Or download the app: https://ollama.com/download
```

### Step 2 — Start the Ollama server

```bash
ollama serve
# Runs at http://localhost:11434
```

### Step 3 — Pull the two models we need

```bash
# LLM for chat and SQL (2GB download)
ollama pull llama3.2

# Embedding model for RAG (274MB download)
ollama pull nomic-embed-text

# Verify both are ready
ollama list
```

**What's happening:**
- `llama3.2` is a 3-billion parameter LLM. It can understand instructions, write SQL, and summarize data.
- `nomic-embed-text` converts text into a list of 768 numbers (a "vector") that captures semantic meaning.

### Step 4 — Install npm dependencies

```bash
cd backend
npm install
# This adds: @modelcontextprotocol/sdk, zod (already in package.json)
```

### Step 5 — Start everything

```bash
# Terminal 1: ClickHouse (if not already running)
docker compose up -d

# Terminal 2: Backend API
cd backend && node server.js

# Terminal 3: Open the UI
open frontend/index.html
# Click "AI Assistant" in the sidebar
```

### Step 6 — Verify AI is working

```bash
curl http://localhost:3001/api/ai/status
# Should return:
# { "ollama": "running", "llmReady": true, "embedReady": true, "models": [...] }
```

---

## J1 — Text-to-SQL Chatbot

**File:** `backend/ai.js` — see functions `textToSQL()` and `CLICKHOUSE_SCHEMA`

### The Problem

You want users to ask questions like:
> *"Which service had the most errors yesterday?"*

And get back a real answer from your database — without them knowing SQL.

### How It Works — Step by Step

```
User question
    │
    ▼
┌─────────────────────────────────┐
│ 1. SCHEMA INJECTION             │ ← Tell the LLM what tables exist
│    Paste your table definitions │
│    into the system prompt       │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ 2. SQL GENERATION               │ ← LLM writes a SELECT query
│    Few-shot examples guide      │
│    the format (temperature=0)   │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ 3. SAFETY CHECK                 │ ← Only allow SELECT
│    Reject DROP/DELETE/INSERT    │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ 4. EXECUTE on ClickHouse        │ ← Run the SQL, get rows
│    Self-correction if it fails  │ ← Feed error back → LLM fixes it
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ 5. SUMMARIZE                    │ ← LLM turns rows into English
│    "The frontend service had    │
│     17% error rate, the highest"│
└─────────────────────────────────┘
```

### Key Concept: Schema Injection

The LLM has no idea what's in your database. You must inject the schema:

```javascript
// From backend/ai.js
const CLICKHOUSE_SCHEMA = `
You are a ClickHouse SQL expert. Generate ONLY a valid SQL SELECT query.

TABLE: demo.app_logs
  timestamp   DateTime
  level       LowCardinality(String)  -- DEBUG, INFO, WARN, ERROR
  service     LowCardinality(String)
  message     String
  duration_ms UInt32

ClickHouse RULES:
- Use count() not COUNT(*)
- Use quantile(0.95)(col) for P95
- NEVER use columns that don't exist above
`.trim();
```

**Why this matters:** Without the schema, the LLM invents column names and the query fails. With it, accuracy goes from ~30% to ~90%.

### Key Concept: Self-Correction Loop

LLMs make mistakes. The self-correction loop is how agents fix themselves:

```javascript
for (let attempt = 1; attempt <= 3; attempt++) {
    const sql = await askLLM(messages);

    try {
        rows = await runQuery(sql);
        break; // ✅ Success — exit the loop
    } catch (err) {
        // ❌ SQL failed — feed the error back so LLM can fix it
        messages.push(
            { role: 'assistant', content: sql },
            { role: 'user', content: `That failed: "${err.message}". Fix the SQL using ONLY the columns listed in the schema.` }
        );
    }
}
```

This is the same pattern used by GitHub Copilot, Devin, and Claude — they all retry with error feedback.

### Try It

```bash
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Which service has the highest error rate in the last 24 hours?"}'

# Response:
# {
#   "sql": "SELECT service, round(countIf(level='ERROR')/count()*100, 2) AS error_pct ...",
#   "answer": "The frontend service has the highest error rate at 17.22%...",
#   "rows": [...],
#   "rowCount": 5
# }
```

### What to Experiment With

1. **Change the system prompt** — Add "Always LIMIT to 10 rows" and see how the LLM obeys constraints
2. **Remove a column from the schema** — Watch the LLM stop using it
3. **Set temperature to 0.5** — See how responses become less consistent
4. **Add a new table** — The LLM can immediately query it once it's in the schema

---

## J2 — AI Insights Agent

**File:** `backend/ai.js` — see function `generateInsights()`

### The Problem

Instead of waiting for users to ask questions, you want the AI to **proactively scan your data and find problems** — like a senior engineer who runs a morning health check every day.

### What's an "Agent"?

An agent is just a loop with three phases:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   OBSERVE    │────▶│    THINK     │────▶│     ACT      │
│              │     │              │     │              │
│ Run queries  │     │ What does    │     │ Return       │
│ to gather    │     │ this data    │     │ insights or  │
│ real data    │     │ mean?        │     │ call more    │
│              │     │              │     │ tools        │
└──────────────┘     └──────────────┘     └──────────────┘
        ▲                                        │
        └────────────────────────────────────────┘
                    Repeat if needed
```

### How Our Agent Works

**Step 1 — Agent gathers data (tool calls):**

```javascript
// Tool 1: Telemetry diagnostic
const telemetry = await runQuery(`
  SELECT
    service,
    count() AS total_events,
    countIf(event_type = 'error') AS errors,
    quantile(0.95)(duration_ms) AS p95_ms
  FROM demo.telemetry_events
  WHERE timestamp >= now() - INTERVAL 24 HOUR
  GROUP BY service
`);

// Tool 2: Log error rates
const logs = await runQuery(`
  SELECT service,
    round(countIf(level='ERROR') / count() * 100, 2) AS error_pct
  FROM demo.app_logs ...
`);

// Tool 3: Cost anomalies
const costs = await runQuery(`SELECT service, sum(cost_usd) ...`);
```

**Step 2 — Agent sends ALL data to LLM at once:**

```javascript
const insights = await ollamaChat('llama3.2', [{
  role: 'system',
  content: `Analyze operational data. Return a JSON array of insights.
  Each insight: { severity, title, detail, recommendation }`
}, {
  role: 'user',
  content: `Data: ${JSON.stringify({ telemetry, logs, costs })}
  Find the 3-5 most important issues.`
}]);
```

**Step 3 — Parse the structured JSON response:**

```javascript
const jsonMatch = response.match(/\[[\s\S]*\]/);
return JSON.parse(jsonMatch[0]);
// Returns:
// [
//   { severity: "critical", title: "High P95 on data-pipeline",
//     detail: "2882ms P95 is 2x the average...",
//     recommendation: "Check slow query log on data-pipeline service" }
// ]
```

### Key Concept: Structured Output

By telling the LLM to return JSON with a specific schema, you get machine-readable results you can render as cards, charts, or alerts — not just plain text.

**The trick:** `JSON.parse(response.match(/\[[\s\S]*\]/)[0])` — extract the JSON even if the LLM adds surrounding text.

### Try It

```bash
curl "http://localhost:3001/api/ai/insights?section=telemetry"

# Returns insights like:
# {
#   "insights": [
#     {
#       "severity": "critical",
#       "title": "High P95 for Data Pipeline Service",
#       "detail": "P95 of 2882ms is 2x the average...",
#       "recommendation": "Investigate bottlenecks in data-pipeline"
#     }
#   ]
# }
```

### What to Experiment With

1. **Add a new diagnostic query** — e.g., check for services silent for >1 hour
2. **Change the output schema** — Add a `query` field so the LLM cites which data it used
3. **Make it agentic** — Let the LLM decide which tool to call next based on what it finds

---

## J3 — RAG with ClickHouse as Vector Store

**File:** `backend/ai.js` — see `indexDocument()`, `ragQuery()`, `seedRAGKnowledge()`

### The Problem

The LLM only knows what's in its training data (cutoff: 2024). It doesn't know:
- Your internal architecture docs
- Your runbooks
- The ClickHouse specifics you've documented

RAG (Retrieval Augmented Generation) solves this by **finding the relevant parts of your docs and including them in the prompt**.

### Core Idea: Semantic Search

Instead of keyword search ("find docs containing 'MergeTree'"), embedding search finds docs that are **semantically related** to your question — even if they use different words.

```
"How does ClickHouse handle inserts?"
                │
                ▼ embed (nomic-embed-text)
[0.23, -0.18, 0.41, 0.09, ..., -0.37]  ← 768 numbers
                │
                ▼ cosineDistance() in ClickHouse
┌──────────────────────────────────────────────────────────┐
│ knowledge_embeddings table:                              │
│  "MergeTree writes data in parts..."          dist=0.08  │◀── most similar
│  "ReplicatedMergeTree uses ZooKeeper..."      dist=0.21  │
│  "AI agents can call tools..."                dist=0.87  │◀── least similar
└──────────────────────────────────────────────────────────┘
```

### The Two Phases

**INDEX TIME** (run once, or whenever you add new docs):

```javascript
async function indexDocument(source, category, text) {
    // 1. Chunk the text (400 chars, 50 char overlap)
    //    Why chunking? LLMs have limited context windows.
    //    Why overlap? So a key sentence at a chunk boundary isn't split.
    const chunks = [];
    for (let i = 0; i < text.length; i += 350) {
        chunks.push(text.slice(i, i + 400).trim());
    }

    // 2. Embed each chunk (call nomic-embed-text)
    for (const chunk of chunks) {
        const embedding = await ollamaEmbed(chunk);
        // embedding = [0.23, -0.18, 0.41, ...] — 768 floats

        // 3. Store in ClickHouse
        await ch.insert({
            table: 'demo.knowledge_embeddings',
            values: [{ source, category, content: chunk, embedding }],
            format: 'JSONEachRow',
        });
    }
}
```

**The ClickHouse table that stores vectors:**

```sql
CREATE TABLE demo.knowledge_embeddings (
    id          UUID DEFAULT generateUUIDv4(),
    source      LowCardinality(String),
    category    LowCardinality(String),
    content     String,
    embedding   Array(Float32),   -- ← 768 floats stored here
    created_at  DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (source, category, id);
```

**QUERY TIME** (every user question):

```javascript
async function ragQuery(question, k = 5) {
    // 1. Embed the question using the SAME model
    const qVector = await ollamaEmbed(question);
    // [0.19, -0.22, 0.38, ...]

    // 2. Find the k most similar chunks in ClickHouse
    //    cosineDistance = 0 means identical, 2 means opposite
    const retrieved = await runQuery(`
        SELECT source, category, content,
               cosineDistance(embedding, [${qVector.join(',')}]) AS distance
        FROM demo.knowledge_embeddings
        ORDER BY distance ASC      -- smallest distance = most similar
        LIMIT ${k}
    `);

    // 3. Build the context from retrieved chunks
    const context = retrieved
        .map((r, i) => `[${i+1}] (${r.source}/${r.category}): ${r.content}`)
        .join('\n\n');

    // 4. Ask the LLM to answer using ONLY the retrieved context
    const answer = await ollamaChat('llama3.2', [{
        role: 'system',
        content: 'Answer using ONLY the provided context. Cite sources by [N].'
    }, {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${question}`
    }]);

    return { answer, sources: [...new Set(retrieved.map(r => r.source))], retrievedChunks: retrieved };
}
```

### Why ClickHouse Instead of Pinecone?

| | Pinecone / Chroma | ClickHouse |
|---|---|---|
| Setup | Separate service, API key | Already running! |
| Storage | Separate from your data | Same DB as your logs/telemetry |
| SQL joins | Not possible | `JOIN knowledge_embeddings ON ...` |
| Cost | $0.10–$1/1M vectors | Free (you're already paying for CH) |

**The insight:** Any database that can store an array of floats and compute dot products can be a vector store.

### Try It

```bash
# Index a document
curl -X POST http://localhost:3001/api/ai/rag/index \
  -H "Content-Type: application/json" \
  -d '{
    "source": "my-runbook",
    "category": "incidents",
    "text": "When payment-service error rate exceeds 20%, first check the auth-service logs for JWT validation failures. Payment-service depends on auth-service for every transaction. A cascading failure from auth to payment is the most common incident pattern."
  }'

# Query it
curl -X POST http://localhost:3001/api/ai/rag \
  -H "Content-Type: application/json" \
  -d '{"question": "What should I check when payment service errors spike?"}'

# The LLM will cite your runbook and give the correct answer
```

### What to Experiment With

1. **Change chunk size** — Smaller = more precise retrieval; larger = more context per chunk
2. **Try different k values** — k=1 vs k=10, see how answer quality changes
3. **Index your own docs** — Paste anything into the "Index a document" form in the UI
4. **Query without indexing first** — See what happens when the knowledge base is empty

---

## J4 — MCP Server

**File:** `backend/mcp-server.js`

### The Problem

What if you want **Claude Desktop** or **Cursor** to be able to directly query your ClickHouse database — answering questions like "What's causing the errors today?" without you writing any frontend?

MCP (Model Context Protocol) lets you define **tools** that any compatible AI client can call.

### The Architecture

```
Claude Desktop / Cursor
        │
        │ "List the top errors from ClickHouse"
        ▼
  ┌─────────────┐    JSON-RPC over STDIO    ┌──────────────────────┐
  │  MCP Client │◀────────────────────────▶│   mcp-server.js      │
  │  (Claude)   │                           │                      │
  └─────────────┘                           │  Tools:              │
                                            │  - list_tables       │
                                            │  - get_schema        │
                                            │  - query_clickhouse  │
                                            │  - get_top_errors    │
                                            │  - get_latency_stats │
                                            │  - ...               │
                                            └──────────┬───────────┘
                                                       │ SQL
                                                       ▼
                                               ClickHouse DB
```

### How MCP Works

**3 concepts:**
1. **Tool definition** — describes what a tool does (name, description, input schema)
2. **Tool handler** — runs when the AI calls the tool
3. **Transport** — how messages flow (STDIO for local, HTTP+SSE for remote)

**Defining a tool:**

```javascript
// From mcp-server.js
{
    name: 'get_top_errors',
    // ↓ The AI reads this description to decide WHEN to call this tool.
    //   Write it like documentation for a colleague.
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
        required: [],  // both are optional
    },
}
```

**Handling the tool call:**

```javascript
case 'get_top_errors': {
    const hours = args?.hours ?? 24;
    const limit = args?.limit ?? 10;
    const rows = await runQuery(`
        SELECT service, message, count() AS occurrences, max(timestamp) AS last_seen
        FROM demo.app_logs
        WHERE level = 'ERROR'
          AND timestamp >= now() - INTERVAL ${hours} HOUR
        GROUP BY service, message
        ORDER BY occurrences DESC
        LIMIT ${limit}
    `);
    // MCP responses always: [{ type: 'text', text: '...' }]
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
}
```

### Connect to Claude Desktop

1. Open (or create) `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clickhouse": {
      "command": "node",
      "args": ["/Users/YOUR_NAME/.gemini/antigravity/scratch/clickhouse-explorer/backend/mcp-server.js"],
      "env": {
        "CLICKHOUSE_HOST": "localhost",
        "CLICKHOUSE_PORT": "8123",
        "CLICKHOUSE_DB": "demo"
      }
    }
  }
}
```

2. Restart Claude Desktop
3. In a new Claude conversation, ask:  
   *"List the ClickHouse tables and tell me which has the most data"*  
   — Claude will call `list_tables` and answer from real data!

### Test the Server Manually

```bash
# Run the server (it waits for JSON-RPC on stdin)
node backend/mcp-server.js

# In another terminal, send a tool list request
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node backend/mcp-server.js
```

### What to Experiment With

1. **Add a new tool** — e.g., `get_slow_queries` that returns queries taking >500ms
2. **Add input validation** — Use `zod` to reject negative `hours` values
3. **Add a resource** — MCP also supports "resources" (read-only data like config files)
4. **Connect to Cursor** — Same config format, different file location

---

## Key Patterns Reference

### Pattern 1: Ollama API (no SDK needed)

```javascript
// Chat with a model
async function ollamaChat(model, messages, options = {}) {
    const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: { temperature: options.temperature ?? 0.1 }
        }),
    });
    const data = await response.json();
    return data.message.content;  // The LLM's reply
}

// Get an embedding vector
async function ollamaEmbed(text) {
    const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
    });
    const data = await response.json();
    return data.embedding;  // number[] of length 768
}
```

### Pattern 2: Extract JSON from LLM output

LLMs sometimes wrap JSON in markdown. This handles it:

```javascript
function extractJSON(text) {
    // Try to parse directly first
    try { return JSON.parse(text); } catch {}

    // Strip markdown ```json ... ``` fences
    const stripped = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    try { return JSON.parse(stripped); } catch {}

    // Find the first [...] or {...} block
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) return JSON.parse(arrMatch[0]);
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);

    throw new Error('No valid JSON found in LLM response');
}
```

### Pattern 3: Few-shot prompting for SQL

Adding 2-3 examples to the prompt reliably teaches the format:

```javascript
const prompt = `
Example:
Question: How many events in the last hour?
SQL: SELECT count() FROM demo.telemetry_events WHERE timestamp >= now() - INTERVAL 1 HOUR

Example:
Question: Top services by error rate?
SQL: SELECT service, round(countIf(level='ERROR')/count()*100,2) AS pct
     FROM demo.app_logs GROUP BY service ORDER BY pct DESC LIMIT 5

Now answer:
Question: ${userQuestion}
SQL:`;
```

### Pattern 4: Cosine similarity in ClickHouse

```sql
-- Find documents most similar to a query vector
SELECT
    source,
    category,
    content,
    cosineDistance(embedding, [0.23, -0.18, 0.41, ...]) AS distance
FROM demo.knowledge_embeddings
ORDER BY distance ASC   -- 0 = identical, 2 = opposite
LIMIT 5;
```

### Pattern 5: MCP tool return format

```javascript
// Always return this exact structure:
return {
    content: [{
        type: 'text',
        text: JSON.stringify(yourData, null, 2)
    }]
};

// For errors, throw McpError:
throw new McpError(ErrorCode.InvalidParams, 'table not found');
```

---

## Common Problems & Fixes

### Ollama: "connection refused"
```bash
# Ollama server isn't running
ollama serve
# Then wait 3 seconds and retry
```

### Text-to-SQL: "Unknown identifier" errors
The LLM used a column that doesn't exist. Fix: make your schema more explicit:
```
# Bad schema:  "service - string column"
# Good schema: "service LowCardinality(String) -- exact values: frontend, api-gateway, auth-service"
```

### RAG: "No relevant knowledge found"
The knowledge base is empty. Run the seed:
```bash
# Restart the server — it auto-seeds on startup
node backend/server.js
# Or manually index via the UI: click J3 → "Index Your Own Document"
```

### MCP: Claude doesn't see the tools
- Check the JSON in `claude_desktop_config.json` is valid (no trailing commas)
- Make sure the path to `mcp-server.js` is absolute
- Restart Claude Desktop completely (Cmd+Q, not just close window)

### RAG: Answers are wrong / hallucinated
The LLM is not following the "use ONLY the context" instruction. Try:
- Adding "Do NOT use any knowledge outside the provided context. If the context doesn't answer the question, say 'I don't know'."
- Increasing `k` (retrieve more chunks)
- Checking the retrieved chunk quality — print `d.retrievedChunks` to see what was found

---

## Learning Roadmap

**Week 1 — Core patterns**
- [ ] Make Text-to-SQL work for 5 different questions
- [ ] Add a new table to the schema prompt
- [ ] Observe self-correction by manually breaking a column name

**Week 2 — Agents**
- [ ] Add a 4th diagnostic query to the Insights Agent
- [ ] Make the agent output include the SQL it ran
- [ ] Build a simple alarm: if error_pct > 20%, severity = "critical"

**Week 3 — RAG**
- [ ] Index 5 of your own documents
- [ ] Compare k=1 vs k=5 retrieval quality
- [ ] Add metadata filtering: only retrieve chunks from a specific `category`

**Week 4 — MCP**
- [ ] Add a `get_slow_queries` tool
- [ ] Connect to Claude Desktop and ask it to diagnose an incident
- [ ] Add an HTTP/SSE transport so remote clients can connect

---

*All code is in `backend/ai.js` and `backend/mcp-server.js`. Read the comments — every non-obvious line is explained.*
