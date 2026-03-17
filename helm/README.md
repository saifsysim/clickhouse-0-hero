# ClickHouse Local Helm Chart

Run ClickHouse on a local Kubernetes cluster using our minimal Helm chart and **kind** — no cloud account needed.

## Prerequisites

- Docker Desktop (running)
- `kubectl` — [install](https://kubernetes.io/docs/tasks/tools/)
- `helm` — installed to `~/.local/bin/helm` by the setup steps below
- `kind` — installed to `~/.local/bin/kind` by the setup steps below

## Quick Start (copy-paste)

```bash
# 1. Install helm + kind (one-time)
mkdir -p ~/.local/bin
curl -fsSL https://get.helm.sh/helm-v3.17.1-darwin-arm64.tar.gz -o /tmp/helm.tar.gz
tar -zxf /tmp/helm.tar.gz -C /tmp && cp /tmp/darwin-arm64/helm ~/.local/bin/helm && chmod +x ~/.local/bin/helm

curl -fsSL https://kind.sigs.k8s.io/dl/v0.25.0/kind-darwin-arm64 -o ~/.local/bin/kind && chmod +x ~/.local/bin/kind

export PATH="$HOME/.local/bin:$PATH"

# 2. Create a local k8s cluster
kind create cluster --name clickhouse-local --wait 90s

# 3. Deploy ClickHouse (from this directory)
cd clickhouse-explorer/helm
kubectl create namespace clickhouse
helm install clickhouse ./clickhouse --namespace clickhouse

# 4. Wait for pod to be ready (~1-2 min, pulling alpine image)
kubectl rollout status statefulset/clickhouse -n clickhouse --timeout=240s

# 5. Port-forward (in a separate terminal or add & at end)
kubectl port-forward svc/clickhouse 8123:8123 -n clickhouse

# 6. Test!
curl "http://localhost:8123/ping"           # → Ok.
curl "http://localhost:8123/?user=admin&password=localdev123&query=SELECT+version()"
```

## What gets deployed

| Resource | Name | Details |
|---|---|---|
| StatefulSet | `clickhouse` | 1 replica, `clickhouse/clickhouse-server:24.3-alpine` |
| PVC | `data-clickhouse-0` | 5Gi, bound to the pod — data persists across pod restarts |
| Service (headless) | `clickhouse-headless` | Stable DNS for StatefulSet pod resolution |
| Service (client) | `clickhouse` | ClusterIP on 8123 (HTTP) + 9000 (TCP) |
| Secret | `clickhouse-secret` | Stores the admin password |

## Resource usage (local)

| | Request | Limit |
|---|---|---|
| Memory | 512Mi | 1.5Gi |
| CPU | 250m (0.25 core) | 1 core |

## Credentials

- Username: `admin`
- Password: `localdev123` (set in `values.yaml`)

## Upgrade / change values

```bash
# Edit helm/clickhouse/values.yaml then:
helm upgrade clickhouse ./clickhouse --namespace clickhouse
```

## Teardown

```bash
helm uninstall clickhouse --namespace clickhouse
kubectl delete namespace clickhouse         # removes PVCs too
kind delete cluster --name clickhouse-local # removes the whole cluster
```

## Next steps (production)

See the **☕ Kubernetes / Helm** tab in the ClickHouse Explorer UI for:
- Production `values.yaml` with 3 shards × 2 replicas
- StatefulSet with anti-affinity and probes
- StorageClass setup for AWS/GCP/Azure
- ClickHouse Keeper (replaces ZooKeeper)
- Day-2 ops: rolling upgrades, backups, monitoring
