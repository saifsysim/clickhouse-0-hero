// ══════════════════════════════════════════════════════════════════════════════
// ClickHouse on Kubernetes — Helm, StatefulSet, PVC demo page
// ══════════════════════════════════════════════════════════════════════════════

(function () {

    // ── Copy-to-clipboard helper ─────────────────────────────────────────────────
    window.k8sCopy = function (btn) {
        const pre = btn.closest('.k8s-code-wrap').querySelector('pre');
        navigator.clipboard.writeText(pre.textContent).then(() => {
            btn.textContent = '✓ Copied';
            setTimeout(() => (btn.textContent = 'Copy'), 1800);
        });
    };

    // ── Tab switcher ────────────────────────────────────────────────────────────
    window.k8sTab = function (id, btn) {
        document.querySelectorAll('.k8s-section').forEach(s => s.classList.remove('k8s-active'));
        document.querySelectorAll('.k8s-tab-btn').forEach(b => b.classList.remove('k8s-tab-active'));
        document.getElementById(id).classList.add('k8s-active');
        btn.classList.add('k8s-tab-active');
    };

    // ── Render ───────────────────────────────────────────────────────────────────
    function code(lang, text, label) {
        return `
      <div class="k8s-code-wrap">
        ${label ? `<div class="k8s-code-label">${label}</div>` : ''}
        <button class="k8s-copy-btn" onclick="k8sCopy(this)">Copy</button>
        <pre class="k8s-pre k8s-lang-${lang}">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      </div>`;
    }

    function callout(type, text) {
        const icons = { tip: '💡', warn: '⚠️', info: 'ℹ️', ok: '✅' };
        const cls = { tip: 'k8s-tip', warn: 'k8s-warn', info: 'k8s-info', ok: 'k8s-ok' };
        return `<div class="k8s-callout ${cls[type]}">${icons[type]} ${text}</div>`;
    }

    function step(num, title, body) {
        return `
      <div class="k8s-step">
        <div class="k8s-step-num">${num}</div>
        <div class="k8s-step-body">
          <div class="k8s-step-title">${title}</div>
          <div class="k8s-step-content">${body}</div>
        </div>
      </div>`;
    }

    // ── Architecture diagram ────────────────────────────────────────────────────
    function renderArch() {
        return `
      <div class="k8s-arch">
        <div class="k8s-arch-row k8s-arch-top">
          <div class="k8s-arch-box k8s-arch-ingress">Ingress / LoadBalancer<br><small>port 8123 HTTP · 9000 native</small></div>
        </div>
        <div class="k8s-arch-arrow-down">↓</div>
        <div class="k8s-arch-row">
          <div class="k8s-arch-box k8s-arch-svc">Service<br><small>ClusterIP / NodePort</small></div>
        </div>
        <div class="k8s-arch-arrow-down">↓</div>
        <div class="k8s-arch-row k8s-arch-pods">
          ${['clickhouse-0', 'clickhouse-1', 'clickhouse-2'].map((p, i) => `
          <div class="k8s-arch-pod">
            <div class="k8s-arch-box k8s-arch-pod-box">
              <div class="k8s-arch-pod-name">${p}</div>
              <small>StatefulSet replica ${i}</small>
              <div class="k8s-arch-pvc">📀 PVC: data-${p}<br><small>100Gi SSD</small></div>
            </div>
          </div>`).join('')}
        </div>
        <div class="k8s-arch-arrow-down">↕ replication via ClickHouse Keeper</div>
        <div class="k8s-arch-row k8s-arch-pods">
          ${['keeper-0', 'keeper-1', 'keeper-2'].map((p, i) => `
          <div class="k8s-arch-pod">
            <div class="k8s-arch-box k8s-arch-keeper-box">
              <div class="k8s-arch-pod-name">${p}</div>
              <small>Keeper replica ${i}</small>
              <div class="k8s-arch-pvc">📀 PVC: logs-${p}<br><small>10Gi</small></div>
            </div>
          </div>`).join('')}
        </div>
      </div>`;
    }

    // ── Content sections ─────────────────────────────────────────────────────────
    const SECTIONS = [
        {
            id: 'k8s-helm',
            label: '⛵ Helm Install',
            content: `
        <h3 class="k8s-sh">Deploy ClickHouse with the Official Helm Chart</h3>
        <p class="k8s-p">The fastest production-grade path. The official <code>clickhouse-operator</code> or the Bitnami chart handle StatefulSets, PVCs, Services, and Keeper config automatically.</p>

        ${step(1, 'Add the Helm repo', code('bash', `# Official ClickHouse operator (recommended for production)
helm repo add clickhouse-operator https://docs.altinity.com/clickhouse-operator
helm repo update

# Or use the Bitnami chart (simpler, single-node default)
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update`))}

        ${step(2, 'Install with default values (quick start)', code('bash', `kubectl create namespace clickhouse

# Bitnami single-node quickstart
helm install ch bitnami/clickhouse \\
  --namespace clickhouse \\
  --set auth.username=admin \\
  --set auth.password=StrongPass123! \\
  --set shards=1 \\
  --set replicaCount=1 \\
  --set persistence.size=50Gi

# Watch it come up
kubectl get pods -n clickhouse -w`))}

        ${step(3, 'Install with custom values (production)', code('bash', `# Pull default values first, then customize
helm show values bitnami/clickhouse > values.yaml

# Apply your custom values.yaml
helm install ch bitnami/clickhouse \\
  --namespace clickhouse \\
  --values values.yaml \\
  --create-namespace`))}

        ${callout('tip', 'Use <code>helm upgrade --install</code> for idempotent deployments — it installs on first run and upgrades on subsequent runs without errors.')}

        ${step(4, 'Access ClickHouse', code('bash', `# Port-forward HTTP interface
kubectl port-forward svc/ch-clickhouse 8123:8123 -n clickhouse &

# Test with curl
curl "http://localhost:8123/?query=SELECT+version()"

# Port-forward native TCP (for clickhouse-client)
kubectl port-forward svc/ch-clickhouse 9000:9000 -n clickhouse &
clickhouse-client --host localhost --port 9000 \\
  --user admin --password StrongPass123!`))}

        ${step(5, 'Uninstall', code('bash', `helm uninstall ch --namespace clickhouse
# PVCs are retained by default — delete manually if needed:
kubectl delete pvc -n clickhouse --all`))}
      `
        },
        {
            id: 'k8s-values',
            label: '📄 values.yaml',
            content: `
        <h3 class="k8s-sh">Production-grade values.yaml</h3>
        <p class="k8s-p">Key settings for a 3-shard × 2-replica production cluster with SSD storage and resource limits.</p>

        ${code('yaml', `# values.yaml — ClickHouse production cluster (Bitnami chart)

# ── Cluster topology ───────────────────────────────────────────────
shards: 3          # number of shards (horizontal partitions)
replicaCount: 2    # replicas per shard (HA — needs Keeper)

# ── Authentication ─────────────────────────────────────────────────
auth:
  username: admin
  password: ""          # use existingSecret in production
  existingSecret: clickhouse-secret
  existingSecretKey: password

# ── Storage — PVC per pod ──────────────────────────────────────────
persistence:
  enabled: true
  storageClass: fast-ssd   # use gp3 on AWS, premium-ssd on Azure
  size: 200Gi
  accessModes:
    - ReadWriteOnce

# ── Resources ─────────────────────────────────────────────────────
resources:
  requests:
    memory: "8Gi"
    cpu: "2"
  limits:
    memory: "16Gi"
    cpu: "8"

# ── ClickHouse Keeper (replaces ZooKeeper) ─────────────────────────
keeper:
  enabled: true
  replicaCount: 3       # always odd: 3 or 5
  persistence:
    enabled: true
    size: 10Gi
    storageClass: fast-ssd
  resources:
    requests:
      memory: "1Gi"
      cpu: "0.5"
    limits:
      memory: "2Gi"
      cpu: "1"

# ── Service ────────────────────────────────────────────────────────
service:
  type: ClusterIP       # use LoadBalancer to expose externally
  ports:
    http: 8123          # HTTP interface (curl, JDBC)
    tcp: 9000           # native protocol (clickhouse-client)
    interserver: 9009   # inter-replica data sync

# ── Custom ClickHouse config ───────────────────────────────────────
extraConfiguration: |
  <clickhouse>
    <max_connections>1000</max_connections>
    <max_concurrent_queries>200</max_concurrent_queries>
    <mark_cache_size>5368709120</mark_cache_size>  <!-- 5GB mark cache -->
    <uncompressed_cache_size>8589934592</uncompressed_cache_size>  <!-- 8GB -->
    <async_insert_max_data_size>10485760</async_insert_max_data_size>
    <async_insert_busy_timeout_ms>200</async_insert_busy_timeout_ms>
  </clickhouse>

# ── Anti-affinity: spread pods across nodes ────────────────────────
podAntiAffinityPreset: hard   # never schedule two CH pods on same node

# ── Pod disruption budget ──────────────────────────────────────────
pdb:
  create: true
  minAvailable: 1`, 'values.yaml')}

        ${callout('warn', '<strong>Never hardcode passwords</strong> in values.yaml. Use <code>existingSecret</code> pointing to a Kubernetes Secret created with <code>kubectl create secret generic</code>.')}
        ${callout('info', '<code>storageClass: fast-ssd</code> — replace with your cluster\'s SSD storage class. On AWS EKS use <code>gp3</code>, on GKE use <code>premium-rwo</code>, on AKS use <code>managed-premium</code>.')}
      `
        },
        {
            id: 'k8s-statefulset',
            label: '📦 StatefulSet YAML',
            content: `
        <h3 class="k8s-sh">Manual StatefulSet + PVC (no Helm)</h3>
        <p class="k8s-p">If you need full control — no Helm, raw Kubernetes manifests. This shows a 3-replica ClickHouse StatefulSet with per-pod PVCs.</p>

        ${code('yaml', `# clickhouse-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: clickhouse
  namespace: clickhouse
spec:
  serviceName: clickhouse-headless   # must match the headless Service name
  replicas: 3
  selector:
    matchLabels:
      app: clickhouse
  template:
    metadata:
      labels:
        app: clickhouse
    spec:
      # ── Anti-affinity: one CH pod per node ────────────────────────
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values: [clickhouse]
              topologyKey: kubernetes.io/hostname

      containers:
        - name: clickhouse
          image: clickhouse/clickhouse-server:24.3   # LTS version
          ports:
            - name: http
              containerPort: 8123
            - name: tcp
              containerPort: 9000
            - name: interserver
              containerPort: 9009
          env:
            - name: CLICKHOUSE_DB
              value: "default"
            - name: CLICKHOUSE_USER
              value: "admin"
            - name: CLICKHOUSE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: clickhouse-secret  # kubectl create secret generic ...
                  key: password

          # ── Liveness / Readiness probes ─────────────────────────
          livenessProbe:
            httpGet:
              path: /ping
              port: 8123
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 5

          readinessProbe:
            httpGet:
              path: /ping
              port: 8123
            initialDelaySeconds: 10
            periodSeconds: 5

          # ── Resources ──────────────────────────────────────────
          resources:
            requests:
              memory: "8Gi"
              cpu: "2"
            limits:
              memory: "16Gi"
              cpu: "8"

          # ── Volume mounts ──────────────────────────────────────
          volumeMounts:
            - name: data
              mountPath: /var/lib/clickhouse     # data, parts, logs
            - name: config
              mountPath: /etc/clickhouse-server/config.d
              readOnly: true

      volumes:
        - name: config
          configMap:
            name: clickhouse-config

  # ── PVC template — one 200Gi SSD per pod ──────────────────────────
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 200Gi`, 'clickhouse-statefulset.yaml')}

        ${callout('info', '<strong>Why StatefulSet over Deployment?</strong> Pods get stable DNS names (<code>clickhouse-0.clickhouse-headless</code>, <code>clickhouse-1…</code>). Each pod always re-mounts the same PVC after a restart — critical for data persistence. Deployments can reschedule anywhere and lose the PVC association.')}
      `
        },
        {
            id: 'k8s-pvc',
            label: '💾 PVC & Storage',
            content: `
        <h3 class="k8s-sh">Persistent Volume Claims for ClickHouse</h3>
        <p class="k8s-p">ClickHouse is storage-heavy — fast local NVMe or SSD is critical. PVCs decouple storage lifecycle from pod lifecycle.</p>

        ${code('yaml', `# storageclass-ssd.yaml — define a fast SSD StorageClass
# (example for AWS EKS with gp3 — adapt for your cloud)
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "6000"          # max provisioned IOPS
  throughput: "500"     # MB/s
  fsType: ext4
reclaimPolicy: Retain   # IMPORTANT: keep PV if PVC is deleted
volumeBindingMode: WaitForFirstConsumer   # schedule pod first, then provision
allowVolumeExpansion: true   # allow online PVC resize`, 'storageclass-ssd.yaml')}

        ${code('yaml', `# headless-service.yaml — required for StatefulSet stable DNS
apiVersion: v1
kind: Service
metadata:
  name: clickhouse-headless
  namespace: clickhouse
spec:
  clusterIP: None       # headless — no load balancing, DNS only
  selector:
    app: clickhouse
  ports:
    - name: tcp
      port: 9000
    - name: interserver
      port: 9009
---
# client-service.yaml — LoadBalancer for external access
apiVersion: v1
kind: Service
metadata:
  name: clickhouse
  namespace: clickhouse
spec:
  type: ClusterIP       # change to LoadBalancer if needed
  selector:
    app: clickhouse
  ports:
    - name: http
      port: 8123
      targetPort: 8123
    - name: tcp
      port: 9000
      targetPort: 9000`, 'services.yaml')}

        ${code('bash', `# Manually create a PVC (if not using volumeClaimTemplates)
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: clickhouse-data-0
  namespace: clickhouse
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 200Gi
EOF

# Check PVC status
kubectl get pvc -n clickhouse

# Resize PVC (StorageClass must have allowVolumeExpansion: true)
kubectl patch pvc clickhouse-data-0 -n clickhouse \\
  -p '{"spec":{"resources":{"requests":{"storage":"400Gi"}}}}'

# Check PV binding
kubectl get pv | grep clickhouse`, 'PVC management commands')}

        ${callout('warn', '<strong>reclaimPolicy: Retain</strong> — always use this for ClickHouse data PVs. Without it, deleting a PVC deletes the underlying storage and all your data. Use <code>Delete</code> only for ephemeral test clusters.')}
        ${callout('tip', '<strong>Storage sizing rule of thumb:</strong> Raw data × compression ratio (÷ 5–10) + 30% headroom. For 1TB raw event data with LZ4 compression: ~150GB compressed → provision 200GB.')}
      `
        },
        {
            id: 'k8s-keeper',
            label: '🔑 Keeper / Replication',
            content: `
        <h3 class="k8s-sh">ClickHouse Keeper — replacing ZooKeeper</h3>
        <p class="k8s-p">ClickHouse Keeper is the built-in consensus store for ReplicatedMergeTree coordination. Deploy it as its own StatefulSet with a 3-node quorum (always odd number).</p>

        ${code('yaml', `# keeper-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: clickhouse-keeper
  namespace: clickhouse
spec:
  serviceName: clickhouse-keeper-headless
  replicas: 3    # always odd: 3, 5, 7
  selector:
    matchLabels:
      app: clickhouse-keeper
  template:
    metadata:
      labels:
        app: clickhouse-keeper
    spec:
      containers:
        - name: keeper
          image: clickhouse/clickhouse-keeper:24.3
          ports:
            - containerPort: 2181   # client port (ZK-compatible)
            - containerPort: 9234   # Raft consensus port
          env:
            - name: KEEPER_SERVER_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name   # keeper-0, keeper-1, keeper-2
          volumeMounts:
            - name: logs
              mountPath: /var/lib/clickhouse-keeper
          resources:
            requests:
              memory: "1Gi"
              cpu: "0.5"
            limits:
              memory: "2Gi"
              cpu: "1"

  volumeClaimTemplates:
    - metadata:
        name: logs
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 10Gi`, 'keeper-statefulset.yaml')}

        ${code('yaml', `# clickhouse-config.yaml — ConfigMap telling CH where Keeper is
apiVersion: v1
kind: ConfigMap
metadata:
  name: clickhouse-config
  namespace: clickhouse
data:
  keeper.xml: |
    <clickhouse>
      <zookeeper>
        <!-- Keeper pods are addressable as stable DNS via headless service -->
        <node>
          <host>clickhouse-keeper-0.clickhouse-keeper-headless</host>
          <port>2181</port>
        </node>
        <node>
          <host>clickhouse-keeper-1.clickhouse-keeper-headless</host>
          <port>2181</port>
        </node>
        <node>
          <host>clickhouse-keeper-2.clickhouse-keeper-headless</host>
          <port>2181</port>
        </node>
      </zookeeper>
    </clickhouse>

  macros.xml: |
    <clickhouse>
      <macros>
        <!-- {shard} and {replica} are substituted at pod-start time -->
        <shard>01</shard>
        <replica from_env="HOSTNAME"/>   <!-- = clickhouse-0, clickhouse-1 … -->
      </macros>
    </clickhouse>

  replicated-table.xml: |
    <clickhouse>
      <!-- Example: create a replicated table using macros -->
      <!--
        CREATE TABLE events ON CLUSTER my_cluster (
          ts DateTime, service String, event_type String
        )
        ENGINE = ReplicatedMergeTree(
          '/clickhouse/tables/{shard}/events',
          '{replica}'
        )
        ORDER BY (service, ts);
      -->
    </clickhouse>`, 'clickhouse-config-cm.yaml')}

        ${callout('ok', '<strong>Why not ZooKeeper?</strong> ClickHouse Keeper uses the same protocol as ZooKeeper but is written in C++ (same codebase as ClickHouse), has lower latency, smaller footprint, and is actively maintained by the ClickHouse team. New clusters should always use Keeper.')}
      `
        },
        {
            id: 'k8s-ops',
            label: '🛠️ Day-2 Operations',
            content: `
        <h3 class="k8s-sh">Day-2 Operations Cheatsheet</h3>

        ${code('bash', `# ── Rolling upgrade ─────────────────────────────────────────────
# StatefulSets roll out one pod at a time (pod N+1 only after N is Ready)
helm upgrade ch bitnami/clickhouse \\
  --namespace clickhouse \\
  --set image.tag=24.8 \\
  --values values.yaml

# Watch rollout
kubectl rollout status statefulset/ch-clickhouse -n clickhouse

# Rollback if needed
kubectl rollout undo statefulset/ch-clickhouse -n clickhouse`, 'Rolling upgrades')}

        ${code('bash', `# ── Scale replicas (add more replicas to a shard) ───────────────
kubectl scale statefulset ch-clickhouse --replicas=4 -n clickhouse
# New pod gets its own PVC automatically from volumeClaimTemplates
# It syncs data from an existing replica via ReplicatedMergeTree

# ── Backup using ClickHouse SQL ──────────────────────────────────
kubectl exec -it ch-clickhouse-0 -n clickhouse -- \\
  clickhouse-client --query "
    BACKUP DATABASE default
    TO S3('https://s3.amazonaws.com/my-bucket/backups/2024-01-01/', 
           'ACCESS_KEY', 'SECRET_KEY')
  "

# ── Restore ──────────────────────────────────────────────────────
kubectl exec -it ch-clickhouse-0 -n clickhouse -- \\
  clickhouse-client --query "
    RESTORE DATABASE default
    FROM S3('https://s3.amazonaws.com/my-bucket/backups/2024-01-01/',
             'ACCESS_KEY', 'SECRET_KEY')
  "`, 'Scaling & Backup')}

        ${code('bash', `# ── Monitoring — query system tables ────────────────────────────
kubectl exec -it ch-clickhouse-0 -n clickhouse -- \\
  clickhouse-client --query "
    SELECT
      query_duration_ms,
      read_rows,
      formatReadableSize(read_bytes) AS read_size,
      query
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND query_duration_ms > 1000
    ORDER BY query_duration_ms DESC
    LIMIT 10
  "

# ── Check part health ────────────────────────────────────────────
kubectl exec -it ch-clickhouse-0 -n clickhouse -- \\
  clickhouse-client --query "
    SELECT table, count() AS parts, sum(rows) AS total_rows,
           formatReadableSize(sum(bytes_on_disk)) AS disk_size
    FROM system.parts
    WHERE active = 1
    GROUP BY table ORDER BY sum(bytes_on_disk) DESC
  "

# ── Check replication lag ────────────────────────────────────────
kubectl exec -it ch-clickhouse-0 -n clickhouse -- \\
  clickhouse-client --query "
    SELECT database, table, replica_name,
           absolute_delay, future_parts, inserts_in_queue
    FROM system.replicas
    WHERE absolute_delay > 0
  "`, 'Monitoring')}

        ${code('bash', `# ── Resource usage per pod ──────────────────────────────────────
kubectl top pods -n clickhouse
kubectl describe pod ch-clickhouse-0 -n clickhouse | grep -A5 Limits

# ── PVC disk usage ───────────────────────────────────────────────
kubectl exec -it ch-clickhouse-0 -n clickhouse -- \\
  df -h /var/lib/clickhouse

# ── Get all ClickHouse events / errors ──────────────────────────
kubectl get events -n clickhouse --sort-by='.lastTimestamp'
kubectl logs ch-clickhouse-0 -n clickhouse --tail=100 | grep -i error`, 'Resource & Health checks')}

        ${callout('tip', '<strong>HorizontalPodAutoscaler</strong> does not work well with StatefulSets for ClickHouse — scaling must be planned (new shards need data rebalancing). Use VPA (VerticalPodAutoscaler) to auto-tune CPU/memory requests instead.')}
        ${callout('warn', '<strong>Never force-delete a ClickHouse pod</strong> (<code>kubectl delete pod --force --grace-period=0</code>). Always let the StatefulSet controller manage graceful shutdown to avoid data corruption mid-merge.')}
      `
        },
    ];

    function renderPage() {
        return `
      <div id="k8s-inner">
        <div class="k8s-hero">
          <div class="k8s-hero-title">ClickHouse on Kubernetes</div>
          <div class="k8s-hero-sub">Helm chart, StatefulSet, PVC, ClickHouse Keeper, and Day-2 operations — production-ready patterns for running ClickHouse on K8s.</div>
          <div class="k8s-hero-pills">
            <span class="k8s-pill">⛵ Helm</span>
            <span class="k8s-pill">📦 StatefulSet</span>
            <span class="k8s-pill">💾 PVC</span>
            <span class="k8s-pill">🔑 Keeper</span>
            <span class="k8s-pill">🛠️ Day-2 Ops</span>
          </div>
        </div>

        <!-- Architecture overview -->
        <div class="k8s-arch-section">
          <div class="k8s-section-title">🏗️ Cluster Architecture</div>
          ${renderArch()}
          <div class="k8s-arch-legend">
            <span class="k8s-legend-item k8s-legend-ch">ClickHouse pods (StatefulSet) + PVC per pod</span>
            <span class="k8s-legend-item k8s-legend-keeper">Keeper pods (StatefulSet, 3-node quorum)</span>
            <span class="k8s-legend-item k8s-legend-pvc">PVC — SSD, retained on pod restart</span>
          </div>
        </div>

        <!-- Tab nav -->
        <div class="k8s-tabs">
          ${SECTIONS.map((s, i) => `
            <button class="k8s-tab-btn ${i === 0 ? 'k8s-tab-active' : ''}"
              onclick="k8sTab('${s.id}', this)">${s.label}</button>`).join('')}
        </div>

        <!-- Tab content -->
        ${SECTIONS.map((s, i) => `
          <div class="k8s-section ${i === 0 ? 'k8s-active' : ''}" id="${s.id}">
            ${s.content}
          </div>`).join('')}
      </div>`;
    }

    window.initK8sPage = function () {
        const root = document.getElementById('k8s-root');
        if (!root || root.dataset.loaded) return;
        root.innerHTML = renderPage();
        root.dataset.loaded = 'true';
    };

})();
