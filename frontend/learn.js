// ════════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE QUIZ SYSTEM
// ════════════════════════════════════════════════════════════════════════════════

const QUIZ_DATA = {
    1: {
        title: 'Module 01 — Why ClickHouse?', questions: [
            {
                q: 'What type of database is ClickHouse?',
                opts: ['OLTP row-store (like PostgreSQL)', 'OLAP columnar (like Redshift)', 'Document store (like MongoDB)', 'Graph database (like Neo4j)'],
                correct: 1, exp: 'ClickHouse is an OLAP (Online Analytical Processing) columnar database. Data is stored column-by-column on disk, making analytical aggregations over billions of rows extremely fast.'
            },
            {
                q: 'When you run SELECT avg(revenue) FROM sales on a 50-column table, how many columns does ClickHouse read from disk?',
                opts: ['All 50 columns', 'Only the revenue column', 'The first 10 columns', 'All indexed columns'],
                correct: 1, exp: 'Columnar storage means each column is a separate file. ClickHouse reads only the columns referenced in your query — a massive I/O saving versus row stores that read entire rows.'
            },
            {
                q: 'What does "vectorized execution" mean in ClickHouse?',
                opts: ['Processing one row at a time', 'Storing arrays in the database', 'Processing batches of column values using SIMD CPU instructions', 'Splitting queries across CPU cores'],
                correct: 2, exp: 'Vectorized execution processes large batches (e.g. 1024 values) using a single SIMD CPU instruction. This is why ClickHouse can scan billions of rows per second on commodity hardware.'
            }
        ]
    },
    2: {
        title: 'Module 02 — MergeTree: The Core', questions: [
            {
                q: 'What does the ORDER BY clause in a MergeTree table determine?',
                opts: ['The order SELECT results are returned', 'The physical sort order on disk AND the primary index', 'Which columns are compressed', 'The partition layout'],
                correct: 1, exp: 'ORDER BY in MergeTree IS the primary key — it determines physical sort order on disk. The sparse index is built directly from ORDER BY column values.'
            },
            {
                q: 'ClickHouse uses a "sparse" primary index. What does this mean?',
                opts: ['The index covers only some columns', 'One index entry per granule (~8192 rows), not per row', 'The index is stored separately', 'Only used for ORDER BY queries'],
                correct: 1, exp: 'A sparse index stores one pointer per granule (8192 rows by default). This keeps the entire index tiny enough to fit in RAM, enabling fast granule skipping without per-row overhead.'
            },
            {
                q: 'Why is it bad to put a high-cardinality column (like user_id) FIRST in ORDER BY?',
                opts: ['ClickHouse rejects it', 'Every granule has unique values — the index cannot skip any granules for typical filter patterns like WHERE service = \'x\'', 'It massively increases storage', 'It breaks background merges'],
                correct: 1, exp: 'With user_id first, WHERE service = \'payment\' reads all granules — the index is useless for that filter. Put low-cardinality first (service, event_type) so WHERE filters skip maximum granules.'
            }
        ]
    },
    3: {
        title: 'Module 03 — Engine Variants', questions: [
            {
                q: 'Which engine automatically sums numeric columns with matching ORDER BY keys during background merges?',
                opts: ['ReplacingMergeTree', 'CollapsingMergeTree', 'SummingMergeTree', 'AggregatingMergeTree'],
                correct: 2, exp: 'SummingMergeTree sums rows with identical ORDER BY keys during merge. Perfect for billing counters — SELECT sum(cost) reads far fewer pre-aggregated rows instead of millions of raw records.'
            },
            {
                q: 'Your Kafka consumer uses at-least-once delivery and may send duplicate events. Which engine handles this most naturally?',
                opts: ['MergeTree', 'SummingMergeTree', 'ReplacingMergeTree', 'CollapsingMergeTree'],
                correct: 2, exp: 'ReplacingMergeTree keeps the row with the highest version per ORDER BY key on merge. Retry the same INSERT safely — duplicates are resolved. Use SELECT ... FINAL for immediate dedup.'
            },
            {
                q: 'You need to store financial corrections: cancel old entry, insert new. Which engine fits this?',
                opts: ['AggregatingMergeTree', 'ReplacingMergeTree', 'CollapsingMergeTree', 'SummingMergeTree'],
                correct: 2, exp: 'CollapsingMergeTree uses a sign column: +1 insert, -1 cancel. Background merge collapses +1/-1 pairs, leaving only the net. No expensive mutations — just write two rows.'
            },
            {
                q: 'What does AggregatingMergeTree store uniquely in its columns?',
                opts: ['Compressed raw values', 'Partial aggregation states (countState, uniqState, quantileState)', 'Only the latest version of each row', 'Sign-based correction pairs'],
                correct: 1, exp: 'AggregatingMergeTree stores intermediate STATE objects (partial aggregation). These states can be merged across time windows without re-scanning raw data — enabling true incremental pre-aggregation.'
            }
        ]
    },
    4: {
        title: 'Module 04 — Materialized Views', questions: [
            {
                q: 'When does a ClickHouse Materialized View execute and write to its target?',
                opts: ['On every SELECT to source', 'On a cron schedule', 'On every INSERT into the source table', 'Only when triggered with REFRESH'],
                correct: 2, exp: 'MVs are INSERT triggers — they fire synchronously on every INSERT to the source table, running the MV\'s SELECT on the new block and writing results to the target immediately.'
            },
            {
                q: 'You create a MV on a table that already has 5 million rows. What does the MV target initially contain?',
                opts: ['5 million rows', '0 rows — MVs only capture NEW inserts', 'The most recent 100k rows', 'Depends on the WHERE clause'],
                correct: 1, exp: 'This is Mistake #12! MVs are pure INSERT triggers — they cannot see data that existed before they were created. Always backfill: INSERT INTO mv_target SELECT ... FROM source.'
            },
            {
                q: 'After creating a MV on an existing table, what SQL backfills historical data?',
                opts: ['REFRESH MATERIALIZED VIEW', 'ALTER TABLE source REBUILD MV', 'INSERT INTO mv_target SELECT <aggregation> FROM source', 'OPTIMIZE TABLE mv_target FINAL'],
                correct: 2, exp: 'Manual backfill with INSERT INTO mv_target SELECT ... FROM source. You control chunking, filtering by date range, and can parallelise it for full control over the backfill.'
            }
        ]
    },
    5: {
        title: 'Module 05 — Logging & TTL', questions: [
            {
                q: 'What does TTL timestamp + INTERVAL 30 DAY DELETE do in a MergeTree table?',
                opts: ['Deletes rows 30 days after last modification', 'Auto-deletes rows whose timestamp is older than 30 days', 'Compresses data after 30 days', 'Archives to S3 after 30 days'],
                correct: 1, exp: 'TTL evaluates per-row during background merges. Any row where timestamp + 30 days < now() is deleted on the next part merge. Zero external cleanup jobs required.'
            },
            {
                q: 'Why use LowCardinality(String) instead of String for a "service" column?',
                opts: ['It supports NULL values', 'It encrypts the column', 'Dictionary encoding — stores a small integer ID per row, saving storage and speeding GROUP BY', 'It restricts to a predefined set'],
                correct: 2, exp: 'LowCardinality creates a per-column dictionary and stores integer IDs per row. For "service" with 20 unique values across 100M rows, it can shrink that column from GBs to MBs.'
            },
            {
                q: 'Which skip index type best supports LIKE \'%connection refused%\' searches on log messages?',
                opts: ['minmax', 'set', 'tokenbf_v1 — bloom filter on word tokens', 'Primary key index'],
                correct: 2, exp: 'tokenbf_v1 tokenizes text into words and stores a bloom filter per granule. Searching for "connection refused" can skip entire granules that don\'t contain those tokens.'
            }
        ]
    },
    6: {
        title: 'Module 06 — Cost & Aggregations', questions: [
            {
                q: 'When does SummingMergeTree actually perform its summing?',
                opts: ['Immediately on INSERT', 'During background part merge operations', 'On every SELECT', 'When you run OPTIMIZE TABLE'],
                correct: 1, exp: 'Summing happens during background merges — NOT at insert or query time. Multiple un-merged parts can co-exist, which is why you must always use SUM() in queries.'
            },
            {
                q: 'After SummingMergeTree merges, why must you still use SUM() in your query?',
                opts: ['SUM() is cosmetic', 'Not all parts may be merged; SUM() correctly aggregates un-merged raw parts too', 'SummingMergeTree stores state objects', 'You should use sumMerge() instead'],
                correct: 1, exp: 'Between merges you may have both merged (pre-summed) and un-merged raw parts for the same key. SUM() handles both correctly. Think of SummingMergeTree as "merge-time pre-aggregation assistance."'
            },
            {
                q: 'What is the correct column ordering rule for ORDER BY in ClickHouse?',
                opts: ['Highest cardinality first', 'Lowest cardinality first, highest cardinality last', 'Always put timestamp first', 'Any order is equivalent'],
                correct: 1, exp: 'Low cardinality → high cardinality: ORDER BY (service, event_type, user_id, timestamp). Filters on "service" (10 values) skip the most granules. Filters on timestamp alone skip the fewest.'
            }
        ]
    },
    7: {
        title: 'Module 07 — Cluster & Replication', questions: [
            {
                q: 'What is the role of ClickHouse Keeper in a replicated cluster?',
                opts: ['Routes queries to the least-loaded shard', 'Manages user auth', 'Distributed coordination — leader election, replication queue, replica sync', 'Handles S3 storage'],
                correct: 2, exp: 'ClickHouse Keeper is the coordination layer for ReplicatedMergeTree tables. It tracks which parts each replica has and manages the replication queue to keep replicas in sync.'
            },
            {
                q: 'A ClickHouse node loses connection to Keeper. What happens?',
                opts: ['It crashes', 'It continues writing independently', 'It switches to read-only mode to prevent split-brain', 'It promotes itself to a new Keeper leader'],
                correct: 2, exp: 'Without quorum confirmation, accepting writes could cause split-brain (diverged replicas). Going read-only is correct and safe. This is Mistake #10 — "Readonly Tables" in the 13 Mistakes tab.'
            },
            {
                q: 'In a 3-shard Distributed table, you INSERT 9 rows. How do rows distribute?',
                opts: ['All 9 to shard 1', 'All 9 to all 3 shards (full copies)', 'Split across shards by sharding key hash — each shard gets a subset', 'First responding shard gets all'],
                correct: 2, exp: 'A Distributed table uses a sharding key hash (e.g. cityHash64(col) % 3) to route each row to exactly one shard. This horizontally partitions data so each shard holds ~1/N of total.'
            }
        ]
    },
    8: {
        title: 'Module 08 — Real-World Use Cases', questions: [
            {
                q: 'Which engine is best for a Kafka at-least-once pipeline needing idempotent storage?',
                opts: ['MergeTree', 'SummingMergeTree', 'ReplacingMergeTree', 'CollapsingMergeTree'],
                correct: 2, exp: 'ReplacingMergeTree(version) accepts duplicates and resolves them — highest version wins on merge. With SELECT ... FINAL you get clean, deduplicated reads from an at-least-once pipeline.'
            },
            {
                q: 'ClickHouse was originally built by which company for which use case?',
                opts: ['Google for search', 'Meta for social graphs', 'Yandex for ad analytics / clickstream', 'Amazon for e-commerce'],
                correct: 2, exp: 'ClickHouse was built at Yandex in 2008 for Yandex.Metrica web analytics. Ad analytics and clickstream (billions of events/day with complex GROUP BY) is still the archetypal ClickHouse workload.'
            },
            {
                q: 'Which workload is ClickHouse LEAST suited for?',
                opts: ['10 billion event logs', 'Real-time dashboards refreshing every 5 seconds', 'Thousands of concurrent row-level balance UPDATEs per second', 'IoT with 100k sensor readings/sec'],
                correct: 2, exp: 'High-frequency row-level UPDATEs are a ClickHouse anti-pattern. Mutations rewrite entire parts on disk — extremely expensive. Use PostgreSQL/MySQL for mutable transactional workloads.'
            }
        ]
    }
};

// ── Quiz state (localStorage) ─────────────────────────────────────────────────
function getQuizState(num) {
    try { return JSON.parse(localStorage.getItem('ch_quiz_' + num)) || {}; }
    catch { return {}; }
}
function saveQuizState(num, state) {
    localStorage.setItem('ch_quiz_' + num, JSON.stringify(state));
}

// ── Inject quiz container into glesson just before guide-next-row ──────────────
function ensureQuizRendered(num) {
    const lesson = document.getElementById('glesson-' + num);
    if (!lesson || document.getElementById('quiz-block-' + num)) return;
    const qd = QUIZ_DATA[num];
    if (!qd) return;
    const state = getQuizState(num);

    const wrap = document.createElement('div');
    wrap.id = 'quiz-block-' + num;
    wrap.className = 'guide-quiz-wrap';
    wrap.innerHTML =
        '<div class="guide-quiz-hd">' +
        '<span style="font-size:18px">🧠</span>' +
        '<span class="guide-quiz-title">Knowledge Check — ' + qd.title + '</span>' +
        '<span class="guide-quiz-badge" id="quiz-badge-' + num + '">' + buildBadge(num, state, qd) + '</span>' +
        '<button class="btn" style="font-size:10px;padding:3px 8px;margin-left:auto" onclick="resetQuiz(' + num + ')">↺ Reset</button>' +
        '</div>' +
        qd.questions.map(function (q, qi) { return buildQuestion(num, qi, q, state); }).join('');

    const nextRow = lesson.querySelector('.guide-next-row');
    if (nextRow) lesson.insertBefore(wrap, nextRow);
    else lesson.appendChild(wrap);
}

function buildBadge(num, state, qd) {
    const answers = state.answers || {};
    const scored = Object.keys(answers).length;
    const correct = Object.keys(answers).filter(function (qi) { return answers[qi] === qd.questions[+qi].correct; }).length;
    if (scored === 0) return '<span style="color:var(--text3);font-size:12px">Not started</span>';
    if (scored < qd.questions.length) return '<span style="color:#fbbf24;font-size:12px">' + scored + '/' + qd.questions.length + ' answered</span>';
    if (correct === qd.questions.length) return '<span style="color:#6ee7b7;font-size:12px;font-weight:700">✅ Passed!</span>';
    return '<span style="color:#fca5a5;font-size:12px">' + correct + '/' + qd.questions.length + ' correct — try again</span>';
}

function buildQuestion(num, qi, q, state) {
    const answers = state.answers || {};
    const chosen = answers[qi];
    const done = chosen !== undefined;
    const optsHtml = q.opts.map(function (opt, oi) {
        let cls = 'guide-quiz-opt';
        if (done) {
            if (oi === q.correct) cls += ' correct';
            else if (oi === chosen && oi !== q.correct) cls += ' wrong';
        }
        return '<button class="' + cls + '" onclick="selectAnswer(' + num + ',' + qi + ',' + oi + ')" ' +
            (done ? 'disabled' : '') + '>' + String.fromCharCode(65 + oi) + '. ' + escHtml(opt) + '</button>';
    }).join('');
    return '<div class="guide-quiz-q" id="quiz-q-' + num + '-' + qi + '">' +
        '<div class="guide-quiz-qtext">' + (qi + 1) + '. ' + escHtml(q.q) + '</div>' +
        '<div class="guide-quiz-opts">' + optsHtml + '</div>' +
        (done ? '<div class="guide-quiz-exp">💡 ' + escHtml(q.exp) + '</div>' : '') +
        '</div>';
}

function selectAnswer(num, qi, oi) {
    const qd = QUIZ_DATA[num];
    if (!qd) return;
    const state = getQuizState(num);
    if (!state.answers) state.answers = {};
    if (state.answers[qi] !== undefined) return;
    state.answers[qi] = oi;
    saveQuizState(num, state);
    const qEl = document.getElementById('quiz-q-' + num + '-' + qi);
    if (qEl) qEl.outerHTML = buildQuestion(num, qi, qd.questions[qi], state);
    const badge = document.getElementById('quiz-badge-' + num);
    if (badge) badge.innerHTML = buildBadge(num, state, qd);
    updateSidebarBadges();
}

function resetQuiz(num) {
    localStorage.removeItem('ch_quiz_' + num);
    const block = document.getElementById('quiz-block-' + num);
    if (block) block.remove();
    ensureQuizRendered(num);
    updateSidebarBadges();
}

function updateSidebarBadges() {
    for (let n = 1; n <= 8; n++) {
        const btn = document.getElementById('gbtn-' + n);
        if (!btn) continue;
        const qd = QUIZ_DATA[n];
        if (!qd) continue;
        const state = getQuizState(n);
        const answers = state.answers || {};
        const allDone = Object.keys(answers).length === qd.questions.length;
        const allCorrect = allDone && qd.questions.every(function (q, qi) { return answers[qi] === q.correct; });
        let badge = btn.querySelector('.quiz-done-badge');
        if (allCorrect) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'quiz-done-badge';
                badge.textContent = ' ✅';
                btn.querySelector('.guide-mod-meta').appendChild(badge);
            }
        } else if (badge) badge.remove();
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// SQL CHALLENGES
// ════════════════════════════════════════════════════════════════════════════════

const CHALLENGES = [
    {
        id: 1, title: 'p99 Latency Per Service', difficulty: 'Beginner', table: 'telemetry_events',
        prompt: 'Find the p99 latency (in ms) for each service, along with the average latency and total event count. Order slowest first.',
        hint: 'Use quantile(0.99)(column) and GROUP BY service.',
        solution: 'SELECT\n    service,\n    quantile(0.99)(duration_ms) AS p99_ms,\n    round(avg(duration_ms), 2)  AS avg_ms,\n    count()                     AS total_events\nFROM demo.telemetry_events\nGROUP BY service\nORDER BY p99_ms DESC;'
    },

    {
        id: 2, title: 'Error Count Per Service (Last 24h)', difficulty: 'Beginner', table: 'app_logs',
        prompt: 'Count the number of ERROR-level log entries per service in the last 24 hours, ordered by most errors first.',
        hint: "Filter: WHERE level = 'ERROR' AND timestamp >= now() - INTERVAL 24 HOUR.",
        solution: "SELECT\n    service,\n    count() AS error_count\nFROM demo.app_logs\nWHERE level = 'ERROR'\n  AND timestamp >= now() - INTERVAL 24 HOUR\nGROUP BY service\nORDER BY error_count DESC;"
    },

    {
        id: 3, title: 'Busiest Hour of the Day', difficulty: 'Beginner', table: 'telemetry_events',
        prompt: 'Which hour of the day (0–23) has the most total events across all services? Show the top 5.',
        hint: 'Use toHour(timestamp) to extract the hour.',
        solution: 'SELECT\n    toHour(timestamp) AS hour_of_day,\n    count()           AS total_events\nFROM demo.telemetry_events\nGROUP BY hour_of_day\nORDER BY total_events DESC\nLIMIT 5;'
    },

    {
        id: 4, title: 'Slowest Event Types on Average', difficulty: 'Beginner', table: 'telemetry_events',
        prompt: 'Find the average duration_ms per event_type. Show from slowest to fastest.',
        hint: 'Use avg() and round() with GROUP BY event_type.',
        solution: 'SELECT\n    event_type,\n    round(avg(duration_ms), 2) AS avg_ms,\n    count()                    AS total_events\nFROM demo.telemetry_events\nGROUP BY event_type\nORDER BY avg_ms DESC;'
    },

    {
        id: 5, title: 'Services With Error Rate > 5%', difficulty: 'Intermediate', table: 'app_logs',
        prompt: 'Find services where more than 5% of log entries in the last 7 days are ERROR level.',
        hint: 'Use countIf(level = \'ERROR\') for conditional counting. Filter with HAVING after GROUP BY.',
        solution: "SELECT\n    service,\n    countIf(level = 'ERROR')                              AS errors,\n    count()                                               AS total,\n    round(100.0 * countIf(level = 'ERROR') / count(), 2) AS error_rate_pct\nFROM demo.app_logs\nWHERE timestamp >= now() - INTERVAL 7 DAY\nGROUP BY service\nHAVING error_rate_pct > 5\nORDER BY error_rate_pct DESC;"
    },

    {
        id: 6, title: 'Monthly Spend Per Team', difficulty: 'Beginner', table: 'cost_usage',
        prompt: 'Show total spending per team broken down by calendar month.',
        hint: 'Use toStartOfMonth(date) to bucket by month.',
        solution: 'SELECT\n    team,\n    toStartOfMonth(date) AS month,\n    round(sum(cost_usd), 2) AS total_spend\nFROM demo.cost_usage\nGROUP BY team, month\nORDER BY team, month;'
    },

    {
        id: 7, title: 'Unique Users Per Event Type', difficulty: 'Beginner', table: 'telemetry_events',
        prompt: 'How many distinct user_ids triggered each event_type? Show as approximate count too.',
        hint: 'Use countDistinct(user_id) for exact, or uniq(user_id) for faster approximate.',
        solution: 'SELECT\n    event_type,\n    countDistinct(user_id) AS exact_unique_users,\n    uniq(user_id)          AS approx_unique_users,\n    count()                AS total_events\nFROM demo.telemetry_events\nGROUP BY event_type\nORDER BY exact_unique_users DESC;'
    },

    {
        id: 8, title: 'p50 vs p99 Spread', difficulty: 'Intermediate', table: 'telemetry_events',
        prompt: 'Compare p50 and p99 latency per service. Compute a "spread ratio" (p99/p50). High ratio = inconsistent service.',
        hint: 'You can call quantile() multiple times in one SELECT — once for each percentile.',
        solution: 'SELECT\n    service,\n    quantile(0.50)(duration_ms)                                          AS p50_ms,\n    quantile(0.99)(duration_ms)                                          AS p99_ms,\n    round(quantile(0.99)(duration_ms) / quantile(0.50)(duration_ms), 1) AS spread_ratio\nFROM demo.telemetry_events\nGROUP BY service\nORDER BY spread_ratio DESC;'
    },

    {
        id: 9, title: 'Events in 5-Minute Buckets', difficulty: 'Intermediate', table: 'telemetry_events',
        prompt: 'Show event counts in 5-minute time buckets for the last 2 hours. Useful for spotting traffic spikes.',
        hint: 'Use toStartOfFiveMinutes(timestamp) to bucket into 5-minute windows.',
        solution: 'SELECT\n    toStartOfFiveMinutes(timestamp) AS bucket,\n    count()                         AS events,\n    uniq(user_id)                   AS unique_users\nFROM demo.telemetry_events\nWHERE timestamp >= now() - INTERVAL 2 HOUR\nGROUP BY bucket\nORDER BY bucket;'
    },

    {
        id: 10, title: 'Top 5 Most Frequent Error Messages', difficulty: 'Intermediate', table: 'app_logs',
        prompt: 'Find the 5 most frequently occurring error messages and which service produced them.',
        hint: 'GROUP BY message AND service, then ORDER BY count() DESC LIMIT 5.',
        solution: "SELECT\n    message,\n    service,\n    count() AS occurrences\nFROM demo.app_logs\nWHERE level = 'ERROR'\nGROUP BY message, service\nORDER BY occurrences DESC\nLIMIT 5;"
    },

    {
        id: 11, title: 'Teams That Exceeded $500 in a Month', difficulty: 'Intermediate', table: 'cost_usage',
        prompt: 'Which teams had total monthly spend exceeding $500? Show the month and the total.',
        hint: 'Use HAVING to filter after aggregation — you cannot use WHERE on aggregate results.',
        solution: 'SELECT\n    team,\n    toStartOfMonth(date)    AS month,\n    round(sum(cost_usd), 2) AS total_spend\nFROM demo.cost_usage\nGROUP BY team, month\nHAVING total_spend > 500\nORDER BY total_spend DESC;'
    },

    {
        id: 12, title: 'Rolling 7-Day Event Count', difficulty: 'Advanced', table: 'telemetry_events',
        prompt: 'Compute a rolling 7-day event count per service using a window function over daily aggregates.',
        hint: 'First GROUP BY service + day, then use sum(...) OVER (PARTITION BY service ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW).',
        solution: 'SELECT\n    service,\n    toDate(timestamp)   AS day,\n    count()             AS daily_events,\n    sum(count()) OVER (\n        PARTITION BY service\n        ORDER BY toDate(timestamp)\n        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW\n    )                   AS rolling_7d\nFROM demo.telemetry_events\nGROUP BY service, day\nORDER BY service, day;'
    }
];

let _chalStates = {};

function loadChallenges() {
    try { _chalStates = JSON.parse(localStorage.getItem('ch_chal_states') || '{}'); } catch { _chalStates = {}; }
    const list = document.getElementById('challenges-list');
    if (!list) return;
    list.innerHTML = CHALLENGES.map(buildChallengeCard).join('');
    _updateChalCount();
}

function buildChallengeCard(c) {
    const state = _chalStates[c.id] || {};
    const diffCls = c.difficulty === 'Beginner' ? 'diff-beginner' : c.difficulty === 'Intermediate' ? 'diff-intermediate' : 'diff-advanced';
    return '<div class="chal-card glass' + (state.solved ? ' chal-solved' : '') + '" id="chal-' + c.id + '">' +
        '<div class="chal-card-header">' +
        '<div class="chal-num">' + String(c.id).padStart(2, '0') + '</div>' +
        '<div style="flex:1">' +
        '<div class="chal-title">' + c.title + (state.solved ? ' <span class="chal-done-badge">✅ Solved</span>' : '') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:4px">' +
        '<span class="diff-badge ' + diffCls + '">' + c.difficulty + '</span>' +
        '<span style="font-size:11px;color:var(--text3)">Table: <code>' + c.table + '</code></span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="chal-prompt">' + escHtml(c.prompt) + '</div>' +
        '<textarea class="chal-editor" id="chal-ed-' + c.id + '" spellcheck="false" placeholder="-- Write your SQL here&#10;SELECT ...">' + escHtml(state.userSql || '') + '</textarea>' +
        '<div class="chal-action-row">' +
        '<button class="btn btn-primary" onclick="runChallenge(' + c.id + ')">▶ Run</button>' +
        '<button class="btn" onclick="chalToggle(\'hint\', ' + c.id + ')">💡 Hint</button>' +
        '<button class="btn" onclick="chalToggle(\'sol\', ' + c.id + ')">🔑 Solution</button>' +
        '</div>' +
        '<div class="chal-hint" id="chal-hint-' + c.id + '" style="display:none"><strong>Hint:</strong> ' + escHtml(c.hint) + '</div>' +
        '<div class="chal-solution" id="chal-sol-' + c.id + '" style="display:none">' +
        '<div class="chal-sol-label">Sample Solution</div>' +
        '<pre class="chal-sol-pre">' + escHtml(c.solution) + '</pre>' +
        '<button class="btn" style="font-size:11px;margin-top:6px" onclick="useSolution(' + c.id + ')">Use this ↑</button>' +
        '</div>' +
        '<div id="chal-result-' + c.id + '" class="chal-result"></div>' +
        '</div>';
}

function chalToggle(type, id) {
    const el = document.getElementById('chal-' + type + '-' + id);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}
function useSolution(id) {
    const c = CHALLENGES.find(function (x) { return x.id === id; });
    const ed = document.getElementById('chal-ed-' + id);
    if (c && ed) ed.value = c.solution;
    chalToggle('sol', id);
}

async function runChallenge(id) {
    const ed = document.getElementById('chal-ed-' + id);
    const resEl = document.getElementById('chal-result-' + id);
    if (!ed || !resEl) return;
    const sql = ed.value.trim();
    if (!sql) { resEl.innerHTML = '<div class="chal-msg warn">Write a SQL query first.</div>'; return; }
    resEl.innerHTML = '<div class="chal-msg">⏳ Running against ClickHouse…</div>';
    try {
        const r = await fetch(API + '/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
        const data = await r.json();
        if (data.error) { resEl.innerHTML = '<div class="chal-msg error">❌ ' + escHtml(data.error) + '</div>'; return; }
        const rows = Array.isArray(data) ? data : (data.data || data.rows || []);
        if (!rows.length) { resEl.innerHTML = '<div class="chal-msg">✅ Query ran OK — 0 rows returned.</div>'; return; }
        const cols = Object.keys(rows[0]);
        resEl.innerHTML =
            '<div class="chal-rows-info">' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' returned</div>' +
            '<div class="chal-table-wrap">' +
            '<table class="chal-tbl">' +
            '<thead><tr>' + cols.map(function (c) { return '<th>' + escHtml(c) + '</th>'; }).join('') + '</tr></thead>' +
            '<tbody>' + rows.slice(0, 100).map(function (row) {
                return '<tr>' + cols.map(function (c) { return '<td>' + escHtml(String(row[c] == null ? '' : row[c])) + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody>' +
            '</table>' +
            '</div>';
        // Mark solved
        if (!(_chalStates[id] && _chalStates[id].solved)) {
            _chalStates[id] = { solved: true, userSql: sql };
            try { localStorage.setItem('ch_chal_states', JSON.stringify(_chalStates)); } catch { }
            const card = document.getElementById('chal-' + id);
            if (card) {
                card.classList.add('chal-solved');
                const title = card.querySelector('.chal-title');
                if (title && !title.querySelector('.chal-done-badge')) title.insertAdjacentHTML('beforeend', ' <span class="chal-done-badge">✅ Solved</span>');
            }
            _updateChalCount();
        }
    } catch (e) { resEl.innerHTML = '<div class="chal-msg error">❌ Backend offline — start the server first.</div>'; }
}

function _updateChalCount() {
    const n = Object.values(_chalStates).filter(function (s) { return s && s.solved; }).length;
    const el = document.getElementById('chal-solved');
    if (el) el.textContent = n;
}

// ════════════════════════════════════════════════════════════════════════════════
// SCHEMA DESIGNER — Decision Tree
// ════════════════════════════════════════════════════════════════════════════════

const SCHEMA_TREE = {
    start: {
        q: 'What type of data will you store?', ctx: 'Start by choosing the fundamental nature of your data.', choices: [
            { lbl: '📊 Events & Clickstream', sub: 'User actions, API calls, page views', next: 'events_append' },
            { lbl: '📋 Logs & Traces', sub: 'Application logs, distributed traces', next: 'logs_retention' },
            { lbl: '📈 Metrics & Time-Series', sub: 'System metrics, sensor readings, counters', next: 'metrics_agg' },
            { lbl: '💰 Financial / Accounting', sub: 'Transactions, ledger entries, corrections', next: 'financial_mut' }
        ]
    },
    events_append: {
        q: 'Is your event data append-only?', ctx: 'Events are usually immutable — but some pipelines need upsert or dedup.', choices: [
            { lbl: '✅ Yes — purely append-only, no updates needed', next: 'events_preagg' },
            { lbl: '🔁 No — I need to upsert or deduplicate by a key', next: 'r_replacing' }
        ]
    },
    events_preagg: {
        q: 'Do you need pre-aggregated results at query time?', ctx: 'Pre-aggregation moves work from query time to write time — great for dashboards.', choices: [
            { lbl: '➕ Yes — simple sums, counts, totals per key', next: 'r_summing' },
            { lbl: '📐 Yes — complex aggregations (distinct count, percentiles)', next: 'r_aggregating' },
            { lbl: '❌ No — I will aggregate at query time', next: 'events_retry' }
        ]
    },
    events_retry: {
        q: 'Could you receive duplicate inserts? (e.g. Kafka at-least-once)', ctx: 'At-least-once delivery guarantees at least one delivery — duplicates are common.', choices: [
            { lbl: '⚠️ Yes — retries or duplicate events are possible', next: 'r_replacing' },
            { lbl: '✅ No — exactly-once delivery guaranteed', next: 'r_mergetree' }
        ]
    },
    logs_retention: {
        q: 'How long do you need to keep logs?', ctx: "ClickHouse TTL auto-expires logs — no external cleanup scripts needed.", choices: [
            { lbl: '📅 Fixed retention (30 / 60 / 90 days)', next: 'r_mergetree_ttl' },
            { lbl: '♾️ Indefinite — keep all logs permanently', next: 'r_mergetree_logs' }
        ]
    },
    metrics_agg: {
        q: 'Do you need automatic metric aggregation as data arrives?', ctx: 'Pre-aggregation at ingest time means faster dashboard queries later.', choices: [
            { lbl: '➕ Yes — sum counters (CPU seconds, bytes, costs)', next: 'metrics_late' },
            { lbl: '📐 Yes — complex rollups (distinct devices, p99 latency)', next: 'r_aggregating' },
            { lbl: '❌ No — store raw time-series, aggregate at query time', next: 'r_mergetree_ts' }
        ]
    },
    metrics_late: {
        q: 'Can data arrive late or be revised after initial delivery?', ctx: 'Cloud billing exports (AWS, GCP) often re-deliver the same record multiple times — or revise a cost record hours/days later.', choices: [
            { lbl: '⏰ Yes — late arrivals or corrections possible (e.g. AWS Cost Explorer)', next: 'r_late_billing' },
            { lbl: '✅ No — data arrives on time and is never revised', next: 'r_summing' }
        ]
    },
    financial_mut: {
        q: 'How do you handle corrections to financial records?', ctx: 'ClickHouse mutations are expensive — design for immutability where possible.', choices: [
            { lbl: '±1 Sign-based corrections (cancel old + insert corrected)', next: 'r_collapsing' },
            { lbl: '🔢 Version-based upsert (keep latest version per ID)', next: 'r_replacing' },
            { lbl: '🔒 Fully immutable (no corrections ever needed)', next: 'r_immutable' }
        ]
    },

    // Results
    r_mergetree: {
        result: true, icon: '🌳', badge: 'Foundation Engine', engine: 'MergeTree',
        tagline: 'The general-purpose backbone of ClickHouse.',
        when: 'Exactly-once pipelines, append-only data, full analytical flexibility.',
        tips: ['Put low-cardinality columns first in ORDER BY', 'PARTITION BY month keeps part count manageable', 'Use LowCardinality for columns with < 10k distinct values'],
        ddl: `CREATE TABLE events (\n    id         UInt64,\n    timestamp  DateTime,\n    service    LowCardinality(String),\n    user_id    String,\n    event_type LowCardinality(String),\n    duration_ms UInt32,\n    properties String DEFAULT ''\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMM(timestamp)\nORDER BY (service, event_type, timestamp)\nSETTINGS index_granularity = 8192;`
    },

    r_replacing: {
        result: true, icon: '🔄', badge: 'Upsert / Dedup', engine: 'ReplacingMergeTree',
        tagline: 'Idempotent writes — highest version wins on merge.',
        when: 'Kafka at-least-once pipelines, retry-safe ingestion, CDC from databases.',
        tips: ['Always query with FINAL or use LIMIT 1 BY id ORDER BY ver DESC', 'Background merges are eventual — dedup is not immediate', 'Use SELECT ... FINAL for correctness; avoid on massive tables (expensive)'],
        ddl: `CREATE TABLE orders (\n    id         UInt64,\n    user_id    String,\n    status     LowCardinality(String),\n    amount     Decimal64(2),\n    updated_at DateTime,\n    ver        UInt64  -- monotonically increasing version\n) ENGINE = ReplacingMergeTree(ver)\nORDER BY id;\n\n-- Query with dedup enforced:\nSELECT * FROM orders FINAL;\n-- Or for large tables:\nSELECT * FROM orders ORDER BY id, ver DESC LIMIT 1 BY id;`
    },

    r_summing: {
        result: true, icon: '➕', badge: 'Auto-Summing Counters', engine: 'SummingMergeTree',
        tagline: 'Pre-aggregate sums at merge time — GROUP BY reads almost nothing.',
        when: 'Billing/cost metering, usage counters, API call totals, byte transfer.',
        tips: ['Always use SUM() at query time — un-merged parts may still exist', 'Non-listed columns keep the value from the first row in a group', 'Pair with a Materialized View for real-time dashboard feeds'],
        ddl: `CREATE TABLE cost_usage (\n    team     LowCardinality(String),\n    service  LowCardinality(String),\n    date     Date,\n    cost_usd Decimal64(4),  -- summed on merge\n    quantity UInt64          -- summed on merge\n) ENGINE = SummingMergeTree(cost_usd, quantity)\nPARTITION BY toYYYYMM(date)\nORDER BY (team, service, date);\n\n-- Always use SUM() — un-merged parts may exist:\nSELECT team, sum(cost_usd) AS spend\nFROM cost_usage GROUP BY team;`
    },

    r_aggregating: {
        result: true, icon: '📐', badge: 'Complex Pre-Aggregation', engine: 'AggregatingMergeTree + MV',
        tagline: 'Store partial aggregation states — merge them cheaply at query time.',
        when: 'Dashboards with distinct counts, percentiles, HyperLogLog cardinality.',
        tips: ['Always backfill after MV creation: INSERT INTO target SELECT ... FROM source', 'Many MVs on one table add insert overhead — profile carefully', 'Column order in the target must exactly match your SELECT output'],
        ddl: `-- 1. Source (raw events)\nCREATE TABLE raw_events (\n    ts DateTime, service LowCardinality(String),\n    user_id String, duration_ms UInt32\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMM(ts) ORDER BY (service, ts);\n\n-- 2. AggregatingMergeTree target\nCREATE TABLE hourly_agg (\n    hour DateTime, service LowCardinality(String),\n    cnt_state AggregateFunction(count),\n    dau_state AggregateFunction(uniq, String),\n    p99_state AggregateFunction(quantile(0.99), UInt32)\n) ENGINE = AggregatingMergeTree()\nORDER BY (service, hour);\n\n-- 3. Materialized View (fires on INSERT to raw_events)\nCREATE MATERIALIZED VIEW mv_hourly TO hourly_agg AS\nSELECT toStartOfHour(ts) AS hour, service,\n    countState()                     AS cnt_state,\n    uniqState(user_id)               AS dau_state,\n    quantileState(0.99)(duration_ms) AS p99_state\nFROM raw_events GROUP BY hour, service;\n\n-- 4. Query:\nSELECT hour, service,\n    countMerge(cnt_state)            AS events,\n    uniqMerge(dau_state)             AS dau,\n    quantileMerge(0.99)(p99_state)   AS p99_ms\nFROM hourly_agg GROUP BY hour, service;`
    },

    r_collapsing: {
        result: true, icon: '±', badge: 'Sign-Based CDC', engine: 'CollapsingMergeTree',
        tagline: 'Write +1 to insert, -1 to cancel. Background merge collapses pairs.',
        when: 'Financial ledgers, inventory deltas, position books, corrections without mutations.',
        tips: ['Background merge collapses +1/-1 pairs eventually', 'Use HAVING sum(sign * qty) != 0 to see only live rows', 'For version-based collapse use VersionedCollapsingMergeTree instead'],
        ddl: `CREATE TABLE positions (\n    account_id UInt64,\n    instrument LowCardinality(String),\n    quantity   Int64,\n    price      Decimal64(2),\n    sign       Int8  -- +1 insert, -1 cancel\n) ENGINE = CollapsingMergeTree(sign)\nORDER BY (account_id, instrument);\n\n-- To correct a record:\n-- Cancel old: INSERT VALUES (acct, instr, old_qty, old_price, -1)\n-- Insert new: INSERT VALUES (acct, instr, new_qty, new_price, +1)\n\n-- Current net positions:\nSELECT account_id, instrument,\n    sum(sign * quantity) AS net_qty\nFROM positions\nGROUP BY account_id, instrument\nHAVING net_qty != 0;`
    },

    r_mergetree_ttl: {
        result: true, icon: '⏰', badge: 'Auto-Expiring Logs', engine: 'MergeTree + TTL',
        tagline: 'Rows auto-deleted when TTL expression fires — no cron jobs.',
        when: 'Log storage with fixed retention, GDPR data deletion, tiered hot/warm/cold.',
        tips: ['TTL deletes happen during background merges — not at midnight', 'PARTITION BY day makes TTL more granular than by month', 'Add TO VOLUME for S3 tiering before full deletion'],
        ddl: `CREATE TABLE app_logs (\n    timestamp DateTime,\n    service   LowCardinality(String),\n    level     LowCardinality(String),\n    message   String,\n    trace_id  String DEFAULT ''\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMMDD(timestamp)\nORDER BY (service, level, timestamp)\nTTL timestamp + INTERVAL 30 DAY DELETE\nSETTINGS index_granularity = 8192;`
    },

    r_mergetree_logs: {
        result: true, icon: '📋', badge: 'Permanent Log Store', engine: 'MergeTree (Indefinite)',
        tagline: 'High-throughput ingest with optional full-text search.',
        when: 'Long-term audit logs, compliance storage, security event archive.',
        tips: ['tokenbf_v1 skip index enables fast word-level search', 'LowCardinality on service/level saves bytes on every row', 'Partition by month for fast partition-level deletion if needed'],
        ddl: `CREATE TABLE audit_logs (\n    timestamp DateTime,\n    service   LowCardinality(String),\n    level     LowCardinality(String),\n    user_id   String,\n    message   String,\n    INDEX msg_idx message TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMM(timestamp)\nORDER BY (service, level, timestamp)\nSETTINGS index_granularity = 8192;`
    },

    r_mergetree_ts: {
        result: true, icon: '🌡️', badge: 'Time-Series', engine: 'MergeTree (Time-Series)',
        tagline: 'ORDER BY (device, timestamp) — range scans are blazing fast.',
        when: 'IoT sensors, stock prices, server metrics — high write rate, time-range queries.',
        tips: ['DateTime64(3) for millisecond precision; DateTime for seconds', 'INDEX skip is perfect for device_id + timestamp range queries', 'Add a Materialized View for hourly/daily rollups to speed dashboards'],
        ddl: `CREATE TABLE sensor_readings (\n    device_id   UInt64,\n    timestamp   DateTime64(3),\n    metric      LowCardinality(String),\n    value       Float64,\n    tags        Map(String, String)\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMM(timestamp)\nORDER BY (device_id, metric, timestamp)\nSETTINGS index_granularity = 8192;`
    },

    r_late_billing: {
        result: true, icon: '☁️', badge: 'Late-Arriving Billing', engine: '3-Layer Architecture',
        tagline: 'ReplacingMergeTree raw layer + SummingMergeTree rollups + CollapsingMergeTree budgets.',
        when: 'AWS/GCP Cost Explorer exports, cloud billing with late arrives or corrections, at-least-once billing pipelines.',
        tips: [
            'PARTITION BY usage_date (not export/arrival date) — late records land in the correct partition',
            'Always use FINAL or LIMIT 1 BY key on raw layer for consistent reads',
            'The Materialized View only fires for new INSERTs — backfill raw data with INSERT SELECT after MV creation',
            'SUM() is still required on SummingMergeTree — un-merged parts may exist'
        ],
        ddl: `-- ① RAW LAYER: handles duplicates + late corrections\n-- Cloud providers re-deliver corrected records with higher version\nCREATE TABLE cost_usage_raw (\n    usage_date    Date,               -- actual usage day (not arrival date!)\n    account_id    LowCardinality(String),\n    service       LowCardinality(String),\n    resource_id   String,\n    usage_qty     Float64,\n    cost_usd      Decimal(18, 6),\n    version       UInt64              -- unix epoch of export delivery\n) ENGINE = ReplacingMergeTree(version)\nPARTITION BY toYYYYMM(usage_date)    -- partition by usage, not arrival!\nORDER BY (account_id, service, resource_id, usage_date);\n\n-- Deduplicated read (always use FINAL or LIMIT 1 BY pattern):\nSELECT account_id, service, sum(cost_usd) AS total\nFROM cost_usage_raw FINAL\nGROUP BY account_id, service;\n\n-- ② ROLLUP LAYER: fast dashboard queries\nCREATE MATERIALIZED VIEW cost_daily_mv\nENGINE = SummingMergeTree(cost_usd)\nORDER BY (account_id, service, usage_date) AS\nSELECT account_id, service, usage_date,\n       sum(cost_usd) AS cost_usd\nFROM cost_usage_raw GROUP BY account_id, service, usage_date;\n\n-- ③ BUDGET LAYER: amendments with sign-based correction\nCREATE TABLE budget_limits (\n    account_id  LowCardinality(String),\n    service     LowCardinality(String),\n    budget_usd  Decimal(18, 2),\n    sign        Int8   -- +1 = active, -1 = cancels previous\n) ENGINE = CollapsingMergeTree(sign)\nORDER BY (account_id, service);\n\n-- Net current budgets:\nSELECT account_id, service,\n       sum(sign * budget_usd) AS current_budget\nFROM budget_limits\nGROUP BY account_id, service\nHAVING current_budget > 0;`
    },

    r_immutable: {
        result: true, icon: '🔒', badge: 'Immutable Ledger', engine: 'MergeTree (Write-Once)',
        tagline: 'Append corrections as new rows — never UPDATE or DELETE.',
        when: 'Double-entry bookkeeping, audit trails, regulatory records.',
        tips: ['Enforce immutability at application layer', 'Use UUID as entry ID for global uniqueness', 'Add a checksum column for integrity verification'],
        ddl: `CREATE TABLE ledger (\n    id            UUID DEFAULT generateUUIDv4(),\n    recorded_at   DateTime DEFAULT now(),\n    account_id    UInt64,\n    description   LowCardinality(String),\n    debit_amount  Decimal64(2) DEFAULT 0,\n    credit_amount Decimal64(2) DEFAULT 0,\n    currency      LowCardinality(String) DEFAULT 'USD'\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMM(recorded_at)\nORDER BY (account_id, recorded_at, id);\n\n-- Current balance per account:\nSELECT account_id,\n    sum(credit_amount) - sum(debit_amount) AS balance\nFROM ledger GROUP BY account_id;`
    }
};

let _schemaPath = [];

function initSchemaDesigner() {
    _schemaPath = [];
    const res = document.getElementById('schema-result');
    if (res) res.style.display = 'none';
    _renderSchemaNode('start');
}

function _renderSchemaNode(nodeId) {
    const node = SCHEMA_TREE[nodeId];
    if (!node) return;
    if (node.result) { _renderSchemaResult(node); return; }
    const el = document.getElementById('schema-steps');
    if (!el) return;
    const crumb = _schemaPath.length > 0
        ? '<div class="schema-breadcrumb">' + _schemaPath.map(function (s) { return '<span>' + escHtml(s) + '</span>'; }).join(' › ') + '</div>'
        : '';
    el.innerHTML = crumb +
        '<div class="schema-step-num">Step ' + (_schemaPath.length + 1) + '</div>' +
        '<div class="schema-question">' + escHtml(node.q) + '</div>' +
        '<div class="schema-context">' + escHtml(node.ctx) + '</div>' +
        '<div class="schema-choices">' +
        node.choices.map(function (c, i) {
            return '<button class="schema-choice" onclick="_schemaChoose(\'' + c.next + '\', \'' + escHtml(c.lbl).replace(/'/g, "\\'") + '\')">' +
                '<span class="schema-choice-lbl">' + c.lbl + '</span>' +
                (c.sub ? '<span class="schema-choice-sub">' + escHtml(c.sub) + '</span>' : '') +
                '</button>';
        }).join('') +
        '</div>' +
        (_schemaPath.length > 0 ? '<button class="btn" style="margin-top:16px;font-size:12px" onclick="_schemaBack()">← Back</button>' : '');
}

function _schemaChoose(nextId, label) {
    _schemaPath.push(label);
    _renderSchemaNode(nextId);
}

function _schemaBack() {
    _schemaPath.pop();
    // Replay path from start
    var path = _schemaPath.slice();
    _schemaPath = [];
    var nodeId = 'start';
    for (var i = 0; i < path.length; i++) {
        var node = SCHEMA_TREE[nodeId];
        if (!node || node.result) break;
        var choice = node.choices.find(function (c) { return c.lbl === path[i]; });
        if (choice) { _schemaPath.push(path[i]); nodeId = choice.next; }
    }
    var res = document.getElementById('schema-result');
    if (res) res.style.display = 'none';
    _renderSchemaNode(nodeId);
}

function _renderSchemaResult(node) {
    var steps = document.getElementById('schema-steps');
    var res = document.getElementById('schema-result');
    if (!steps || !res) return;
    var crumb = _schemaPath.map(function (s) { return '<span>' + escHtml(s) + '</span>'; }).join(' › ');
    steps.innerHTML =
        '<div class="schema-breadcrumb">' + crumb + '</div>' +
        '<div class="schema-result-hero">' +
        '<div class="schema-hero-icon">' + node.icon + '</div>' +
        '<div>' +
        '<div class="schema-hero-badge">' + escHtml(node.badge) + '</div>' +
        '<div class="schema-hero-engine">' + escHtml(node.engine) + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="schema-tagline">' + escHtml(node.tagline) + '</div>' +
        '<div class="schema-when"><strong>Best for:</strong> ' + escHtml(node.when) + '</div>' +
        '<div class="schema-tips">' +
        node.tips.map(function (t) { return '<div class="schema-tip">✅ ' + escHtml(t) + '</div>'; }).join('') +
        '</div>' +
        '<button class="btn" style="margin-top:20px;font-size:12px" onclick="initSchemaDesigner()">← Start Over</button>';

    res.style.display = '';
    var ddl = node.ddl;
    res.innerHTML =
        '<div class="schema-ddl-hd">📄 Recommended DDL Template</div>' +
        '<pre class="schema-ddl-pre">' + escHtml(ddl) + '</pre>' +
        '<button class="btn btn-primary" style="margin-top:12px;font-size:12px" onclick="_copyDDL(this)">📋 Copy DDL</button>';
    res.querySelector('button')._ddl = ddl;
}

function _copyDDL(btn) {
    navigator.clipboard.writeText(btn._ddl || '').then(function () {
        var orig = btn.textContent; btn.textContent = '✅ Copied!';
        setTimeout(function () { btn.textContent = orig; }, 2000);
    });
}
