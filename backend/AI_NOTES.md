# AI Module — Developer Notes for Learners

> Read this before opening `ai.js` or `mcp-server.js`.
> Every code block has a corresponding section in `../AI_GUIDE.md`.

---

## Files in this folder

| File | What it teaches |
|------|----------------|
| `ai.js` | Three AI patterns: Text-to-SQL, Insights Agent, RAG |
| `mcp-server.js` | MCP protocol: how Claude/Cursor calls your tools |
| `server.js` | Express routes that expose /api/ai/* endpoints |

---

## Reading Order

### If you're new to AI engineering:
1. `ai.js` lines 1–95 → Ollama HTTP client (the simplest possible LLM wrapper)
2. `ai.js` lines 96–255 → Text-to-SQL + self-correction loop ← **start here**
3. `ai.js` lines 256–336 → Insights Agent (structured agent loop)
4. `ai.js` lines 337–538 → RAG: embeddings + cosineDistance in ClickHouse
5. `mcp-server.js` → MCP server from scratch

### If you already know LLMs:
- Jump to `ragQuery()` in `ai.js` to see how ClickHouse replaces Pinecone
- Jump to `mcp-server.js` to see the STDIO transport and tool schema

---

## The Three Core Functions in ai.js

### `ollamaChat(model, messages, options)`
- Where: lines ~30–47
- What: Bare HTTP call to `http://localhost:11434/api/chat`
- **Learn**: LLMs are just REST APIs — no SDK needed

### `ollamaEmbed(text)`
- Where: lines ~49–68
- What: Calls `/api/embeddings` → returns `number[]` of length 768
- **Learn**: Embedding = converting text into a point in 768-dimensional space

### `textToSQL(question)`
- Where: lines ~155–255
- What: Schema injection → SQL generation → safety check → execute → self-correct → summarize
- **Learn**: Self-correction is the KEY agentic pattern — errors feed back into the conversation

### `generateInsights(section)`
- Where: lines ~239–336
- What: Runs diagnostic SQL queries → sends all data to LLM → parses structured JSON response
- **Learn**: Agents gather data FIRST, then reason over it — not the other way around

### `indexDocument(source, category, text)`
- Where: lines ~384–410
- What: Text → chunk → embed → INSERT Array(Float32) into ClickHouse
- **Learn**: ClickHouse `Array(Float32)` column IS the vector store

### `ragQuery(question, k)`
- Where: lines ~419–483
- What: Embed question → `cosineDistance()` SQL → retrieve K chunks → grounded LLM answer
- **Learn**: The SQL query that does similarity search:
  ```sql
  SELECT content, cosineDistance(embedding, [?]) AS dist
  FROM demo.knowledge_embeddings
  ORDER BY dist ASC LIMIT 5
  ```

---

## The 8 MCP Tools in mcp-server.js

| Tool | SQL it runs | What the AI can learn |
|------|------------|----------------------|
| `list_tables` | `SELECT name, engine, total_rows FROM system.tables` | All tables + sizes |
| `get_schema` | `SELECT name, type FROM system.columns WHERE table=?` | Column definitions |
| `query_clickhouse` | User-supplied SELECT | Anything (SELECT only!) |
| `get_telemetry_summary` | Grouped telemetry stats | Service performance |
| `get_top_errors` | Top ERROR-level log messages | What's breaking |
| `get_cost_breakdown` | Sum(cost_usd) by service/team | Who's spending what |
| `get_latency_stats` | P50/P95/P99 by service | Slowest services |
| `get_cluster_status` | system.clusters + system.replicas | Node health |

---

## Common Mistakes When Learning

### 1. Using the wrong model name
```javascript
// ❌ Wrong — model not pulled
await ollamaChat('gpt-4', ...)

// ✅ Right — use what you've pulled
await ollamaChat('llama3.2', ...)

// Check what's available:
// curl http://localhost:11434/api/tags
```

### 2. Schema columns don't match real columns
```javascript
// ❌ Wrong — LLM invents columns using wrong names
const schema = `TABLE: error_summary  message String`;

// ✅ Right — use exact names from system.columns
const schema = `TABLE: demo.error_summary  error_msg String`; // NOT "message"
```

### 3. Forgetting to handle LLM JSON parse failures
```javascript
// ❌ Wrong — crashes if LLM adds "Here is the JSON:" before the array
return JSON.parse(response);

// ✅ Right — extract just the JSON block
const match = response.match(/\[[\s\S]*\]/);
return JSON.parse(match[0]);
```

### 4. Using console.log in MCP server
```javascript
// ❌ BREAKS the MCP protocol! stdout is reserved for JSON-RPC messages
console.log('Server started');

// ✅ Right — use stderr
process.stderr.write('Server started\n');
```

---

## Quick Experiment Ideas

```bash
# 1. Test if Ollama is working
curl http://localhost:11434/api/chat \
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"Say hello"}],"stream":false}'

# 2. Test a raw embedding
curl http://localhost:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"ClickHouse MergeTree"}'
# Returns 768 floats

# 3. Test Text-to-SQL
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"How many log entries were written today?"}'

# 4. Test Insights Agent (takes ~30s)
curl "http://localhost:3001/api/ai/insights?section=telemetry"

# 5. Index a document and immediately search it
curl -X POST http://localhost:3001/api/ai/rag/index \
  -H "Content-Type: application/json" \
  -d '{"source":"test","category":"learning","text":"cosineDistance returns 0 for identical vectors and 2 for completely opposite vectors. Smaller values mean more similar documents."}'

curl -X POST http://localhost:3001/api/ai/rag \
  -H "Content-Type: application/json" \
  -d '{"question":"What does cosineDistance return for similar documents?"}'
```
