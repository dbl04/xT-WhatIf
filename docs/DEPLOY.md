# Deploying xT-WhatIf to Azure

Nothing is deployed automatically: pushes and pull requests only run the tests. The Azure
deployment runs when someone starts the **CI/CD** workflow by hand with **deploy to Azure**
ticked. That keeps the demo private until we choose to publish it.

## What gets deployed

| Azure resource | Name | Role | Replicas |
|---|---|---|---|
| Container Apps | `xt-whatif-frontend` | Next.js app. Reads the backend URLs from its environment at runtime (`API_URL`, `WS_URL`, `LIVE_API_URL`, `LIVE_WS_URL`). | 1–5 |
| Container Apps | `xt-whatif-aca-gateway` | Stateless API: simulations, optimiser, TTS, telemetry, chaos. `LIVE_ENABLED=false`. | 1–10 (KEDA, 20 concurrent requests) |
| Container Apps | `xt-whatif-live` | **The** live match: `/ws/live`, the moment cycle, scoring, leaderboard, bots, and the preview of live moments. Offloads moment Validator searches (`attack` + `defend` in parallel) to AKS as events happen. | exactly 1 |
| AKS (optional) | `xt-whatif-aks-worker` | Geometry and moment Validator workers (`POST /api/v1/game/optimize` guarded by `X-Worker-Token`, plus `POST /api/v1/simulate`) behind a LoadBalancer service and the caller's circuit breaker. | 3–12 (HPA) |
| Container Registry | `xtwhatifprodacr` | Images tagged with the commit SHA. | — |
| Log Analytics | `xtwhatif-prod-logs` | Container logs. | — |
| Managed identity | `xtwhatif-prod-identity` | Shared by the Container Apps: `AcrPull` on the registry (image pulls without a password) and `Monitoring Reader` on the gateway (the telemetry endpoint reads its real replica count). | — |

Why a separate live app with one replica: every fan must see the same match and the same key
moment. If the gateway ran the match, each of its replicas would play a different one. Offloading
the moment Validator's `attack` and `defend` searches to the AKS worker pool keeps the singleton
event loop responsive while events arrive in real time.

All public addresses are `https://<app>.<environment default domain>`. Bicep computes them up
front, so CORS on both APIs only allows the frontend's origin.

## One-off setup (before delivery day)

1. **Resource group and registry.** The workflow pushes images before Bicep runs, so the
   registry must exist first. The name must be `xtwhatifprodacr` (or set the `ACR_NAME`
   repository variable to match).
   ```bash
   az group create --name rg-xt-whatif --location westeurope
   az acr create --resource-group rg-xt-whatif --name xtwhatifprodacr --sku Basic
   ```
2. **Service principal for GitHub Actions**, scoped to the resource group:
   ```bash
   az ad sp create-for-rbac --name xtwhatif-github --role contributor \
     --scopes /subscriptions/<subscription-id>/resourceGroups/rg-xt-whatif --json-auth
   ```
   Bicep also creates two role assignments (`AcrPull`, `Monitoring Reader`), which Contributor
   cannot do. Give the same service principal permission to assign roles in the resource group
   (`<app-id>` is the `clientId` in the JSON above):
   ```bash
   az role assignment create --assignee <app-id> --role "Role Based Access Control Administrator" \
     --scope /subscriptions/<subscription-id>/resourceGroups/rg-xt-whatif
   ```
3. **One-time AKS cluster setup (for distributed Validator & simulation workers):**
   Create the AKS cluster attached to the ACR, fetch credentials, create the shared worker token
   secret, apply the manifest, and read the LoadBalancer external IP:
   ```bash
   # 1. Create the 2-node AKS cluster and attach ACR
   az aks create -g rg-xt-whatif -n aks-xtwhatif-prod --node-count 2 --node-vm-size Standard_B2s --attach-acr xtwhatifprodacr --generate-ssh-keys

   # 2. Fetch kubeconfig credentials
   az aks get-credentials -g rg-xt-whatif -n aks-xtwhatif-prod

   # 3. Create namespace and the shared X-Worker-Token secret
   kubectl create namespace xt-whatif
   kubectl create secret generic aks-worker-token -n xt-whatif --from-literal=token=<your-random-worker-token>

   # 4. Apply the AKS deployment, LoadBalancer service, and HPA
   kubectl apply -f infra/k8s-aks-workers.yaml

   # 5. Wait for EXTERNAL-IP to be assigned and copy it
   kubectl get svc -n xt-whatif
   ```
4. **Repository secrets** (Settings → Secrets and variables → Actions):
   | Secret | Value |
   |---|---|
   | `AZURE_CREDENTIALS` | The JSON printed in step 2 |
   | `AZURE_SUBSCRIPTION_ID` | Subscription id |
   | `AZURE_OPENAI_API_KEY` | Azure OpenAI / Foundry key (optional: without it the agents use their deterministic fallback) |
   | `AKS_WORKER_TOKEN` | The shared token created in step 3 (`<your-random-worker-token>`) |
5. **Repository variables:**
   | Variable | Value |
   |---|---|
   | `AZURE_RG` | `rg-xt-whatif` (or `rg-xtwhatif-hackathon`) |
   | `AZURE_OPENAI_ENDPOINT` | `https://<your-resource>.openai.azure.com/` |
   | `ACR_NAME` | Only if the registry is not `xtwhatifprodacr` |
   | `AKS_ENABLED` | `true` once the AKS cluster exists (`AKS_CLUSTER_NAME` if it is not `aks-xtwhatif-prod`) |
   | `AKS_WORKER_URL` | `http://<EXTERNAL-IP>:8000` from `kubectl get svc -n xt-whatif` |
6. **Rehearse locally** with the same layout as Azure (gateway, live, frontend):
   ```bash
   docker compose up --build
   ```
   Open http://localhost:3000. The gateway is on :8000 and the live match on :8001.

## Delivery day

1. Merge everything into `main` and check that CI is green.
2. Actions → **CI/CD - Cloud-Native Hybrid Deployment** → **Run workflow**, with **deploy to
   Azure** ticked.
3. The run summary lists the frontend, gateway and live-match URLs.
4. Smoke tests:
   ```bash
   curl https://xt-whatif-aca-gateway.<domain>/health      # service_role: aca-gateway
   curl https://xt-whatif-live.<domain>/health             # service_role: live
   curl https://xt-whatif-live.<domain>/api/v1/live/state  # status: live, clock moving
   ```
   Then open the frontend, create a profile, pick a team, wait for a challenge, play it and
   check the reveal and the leaderboard.
5. Load test through the ingress (from `backend/`):
   ```bash
   python scripts/live_load_test.py --url wss://xt-whatif-live.<domain> --fans 1000 --duration 300
   ```
   Local reference (300 fans, one machine): 300/300 connected, 0 failures, MOMENT_OPEN delivered
   with a median of 0.42 s (including Validator time).
6. Chaos demo for the video: Infrastructure → **Simulate AKS outage**. Both the gateway's and
   the live match service's circuit breakers compute locally and the match never stops. Chaos
   switches itself off after 90 s.
7. The demo must stay reachable until **10 November**.

## After judging

Delete everything (this also stops the costs):
```bash
az group delete --name rg-xt-whatif --yes --no-wait
```

## Known limits

- One live-match replica holds every WebSocket. For far larger crowds the next step is
  Azure Web PubSub for the fan-out, with the match room publishing to it.
- The leaderboard lives in memory; a restart of `xt-whatif-live` starts a new match.
- The Bicep template could not be compiled on the authoring machine (no Azure CLI). Run
  `az bicep build --file infra/main.bicep` once before delivery day.
