# Deploying xT-WhatIf to Azure

Nothing is deployed automatically: pushes and pull requests only run the tests. The Azure
deployment runs when someone starts the **CI/CD** workflow by hand with **deploy to Azure**
ticked. That keeps the demo private until we choose to publish it.

## What gets deployed

| Azure resource | Name | Role | Replicas |
|---|---|---|---|
| Container Apps | `xt-whatif-frontend` | Next.js app. Reads the backend URLs from its environment at runtime (`API_URL`, `WS_URL`, `LIVE_API_URL`, `LIVE_WS_URL`). | 1–5 |
| Container Apps | `xt-whatif-aca-gateway` | Stateless API: simulations, optimiser, TTS, telemetry, chaos. `LIVE_ENABLED=false`. | 1–10 (KEDA, 20 concurrent requests) |
| Container Apps | `xt-whatif-live` | **The** live match: `/ws/live`, the moment cycle, scoring, leaderboard, bots, and the preview of live moments. | exactly 1 |
| AKS (optional) | `xt-whatif-aks-worker` | Geometry workers behind the gateway's circuit breaker. | 3–12 (HPA) |
| Container Registry | `xtwhatifprodacr` | Images tagged with the commit SHA. | — |
| Log Analytics | `xtwhatif-prod-logs` | Container logs. | — |
| Managed identity | `xtwhatif-prod-identity` | Shared by the Container Apps: `AcrPull` on the registry (image pulls without a password) and `Monitoring Reader` on the gateway (the telemetry endpoint reads its real replica count). | — |

Why a separate live app with one replica: every fan must see the same match and the same key
moment. If the gateway ran the match, each of its replicas would play a different one.

All public addresses are `https://<app>.<environment default domain>`. Bicep computes them up
front, so CORS on both APIs only allows the frontend's origin.

## One-off setup (before delivery day)

1. **Resource group and registry.** The workflow pushes images before Bicep runs, so the
   registry must exist first. The name must be `xtwhatifprodacr` (or set the `ACR_NAME`
   repository variable to match).
   ```bash
   az group create --name rg-xtwhatif-hackathon --location westeurope
   az acr create --resource-group rg-xtwhatif-hackathon --name xtwhatifprodacr --sku Basic
   ```
2. **Service principal for GitHub Actions**, scoped to the resource group:
   ```bash
   az ad sp create-for-rbac --name xtwhatif-github --role contributor \
     --scopes /subscriptions/<subscription-id>/resourceGroups/rg-xtwhatif-hackathon --json-auth
   ```
   Bicep also creates two role assignments (`AcrPull`, `Monitoring Reader`), which Contributor
   cannot do. Give the same service principal permission to assign roles in the resource group
   (`<app-id>` is the `clientId` in the JSON above):
   ```bash
   az role assignment create --assignee <app-id> --role "Role Based Access Control Administrator" \n     --scope /subscriptions/<subscription-id>/resourceGroups/rg-xtwhatif-hackathon
   ```
3. **Repository secrets** (Settings → Secrets and variables → Actions):
   | Secret | Value |
   |---|---|
   | `AZURE_CREDENTIALS` | The JSON printed in step 2 |
   | `AZURE_SUBSCRIPTION_ID` | Subscription id |
   | `AZURE_OPENAI_API_KEY` | Azure OpenAI / Foundry key (optional: without it the agents use their deterministic fallback) |
4. **Repository variables:**
   | Variable | Value |
   |---|---|
   | `AZURE_RG` | `rg-xtwhatif-hackathon` |
   | `AZURE_OPENAI_ENDPOINT` | `https://<your-resource>.openai.azure.com/` |
   | `ACR_NAME` | Only if the registry is not `xtwhatifprodacr` |
   | `AKS_ENABLED` | `true` only once the AKS cluster exists (`AKS_CLUSTER_NAME` if it is not `aks-xtwhatif-prod`) |
5. **Rehearse locally** with the same layout as Azure (gateway, live, frontend):
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
   with a median of 0.42 s (including ~0.3 s of Validator time on the server).
6. Chaos demo for the video: Infrastructure → **Simulate AKS outage**. The gateway's circuit
   breaker computes locally and the match never stops. Chaos switches itself off after 90 s.
7. The demo must stay reachable until **10 November**.

## After judging

Delete everything (this also stops the costs):
```bash
az group delete --name rg-xtwhatif-hackathon --yes --no-wait
```

## Known limits

- One live-match replica holds every WebSocket. For far larger crowds the next step is
  Azure Web PubSub for the fan-out, with the match room publishing to it.
- The leaderboard lives in memory; a restart of `xt-whatif-live` starts a new match.
- The Bicep template could not be compiled on the authoring machine (no Azure CLI). Run
  `az bicep build --file infra/main.bicep` once before delivery day.
