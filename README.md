# ⚽ xT-WhatIf: Real-Time Counterfactual Football Intelligence

> **A second screen for match day: at every key moment of a live synthetic match, move the players and see how the threat changes**  
> *Powered by a spatial xT engine, a seeded synthetic match generator and Azure Container Apps (KEDA autoscaling, one shared live-match replica over WebSockets)*  
> Built for the **"Inside the Game" Hackathon** (Microsoft × Premier League). All match data is synthetic: fictional clubs, players and moments.

**▶ Demo video (under 2 minutes): https://www.youtube.com/watch?v=ykWZ24gaOyg**

[![Demo video](https://img.shields.io/badge/Demo_video-YouTube-red?logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=ykWZ24gaOyg)
[![Live demo](https://img.shields.io/badge/Live_demo-xt--whatif--frontend-brightgreen?logo=microsoftazure&logoColor=white)](https://xt-whatif-frontend.graydesert-cc4befb9.francecentral.azurecontainerapps.io)
[![API docs](https://img.shields.io/badge/API_docs-%2Fdocs-brightgreen?logo=fastapi&logoColor=white)](https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io/docs)
[![MCP Server](https://img.shields.io/badge/MCP_Tools-%2Fapi%2Fv1%2Fmcp%2Ftools-0078D4?logo=microsoftazure&logoColor=white)](https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io/api/v1/mcp/tools)
[![Cloud Telemetry](https://img.shields.io/badge/Cloud_Telemetry-%2Fapi%2Fv1%2Fcloud%2Ftelemetry-326CE5?logo=kubernetes&logoColor=white)](https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io/api/v1/cloud/telemetry)

[![CI/CD Cloud Deployment](https://github.com/dbl04/xT-WhatIf/actions/workflows/deploy-azure.yml/badge.svg)](https://github.com/dbl04/xT-WhatIf/actions/workflows/deploy-azure.yml)
[![FastAPI](https://img.shields.io/badge/FastAPI-2.0.0-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![Azure Container Apps](https://img.shields.io/badge/Azure-Container%20Apps-0078D4?logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/products/container-apps)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🎯 Executive Vision

**xT-WhatIf** transforms traditional post-match football analytics into an interactive, real-time counterfactual simulator. Instead of passively analyzing what happened, analysts, coaching staffs, and fans can **pause key match moments, drag and drop defenders or attackers (or issue natural-language voice commands) on a canonical 120×80m pitch, and instantly recalculate tactical metrics**:
- **Expected Threat ($\Delta\text{xT}$)** on a $16 \times 12$ canonical transition matrix.
- **Spatial Dominance ($60 \times 40$)** through vector-accelerated Voronoi tessellations via `scipy.spatial.KDTree`.
- **Passing Lane Shadows** with dynamic Gaussian interception dispersion cones.
- **Dialectical Pundit Debate**: Two contrasting pundit personas analyze the repositioned scenario with numbers taken only from the engine (`xt_at`, `simulate_counterfactual`, `optimizer/solve`). In the public demo their text comes from the deterministic, engine-verified templates; the Azure OpenAI tool-calling path is implemented but not enabled on our Azure for Students subscription (see the note under the architecture):
  - 🤖 **Dr. Voronoi (`AI-QUANT`)**: Mathematical purist evaluating spatial EV, angular apertures, and threat deltas.
  - 📋 **Coach Bianchi (`PRO-COACH`)**: Seasoned tactician focusing on marking profiles, rest defense, and interior channel coverages.
- **Personalised storytelling & audio**: the whole interface and both pundits speak **English or Spanish** (`en-GB` / `es-ES` voices: Azure AI Speech neural TTS when configured, the browser voice in the public demo), and the commentary is rewritten for four audiences (`casual`, `analyst`, `coach`, `audio_description`). See *Personalisation: Language & Audience* below.

---

## 🎮 4 Interactive Modes & 4 Audience Personalisation Profiles

Judges can switch between all modes directly from the **Top Broadcast Bar** without reloading:

### 1. Four Interactive Functional Modes
| Mode | How to access | What it does |
|:-----|:--------------|:-------------|
| **1. Live Match Room** (`En directo` / `Live match`) | Default mode · Top-bar **Live match** pill | Shared real-time synthetic match (`90'` in `300s`, with 200 simulated bot fans) over WebSocket (`/ws/live`) and REST (`/api/v1/live/state`). Outside key moments the board stays locked with a live status banner; when a candidate event passes the Detector + Validator (`MOMENT_OPEN`), all connected fans have 30 seconds to move up to 2 players within a 6.0 m radius (with live trend feedback via `POST /api/v1/game/preview`), get scored (0–1000 pts) against the machine's two-player optimum, hear the pundit reveal read aloud (pre-synthesised Azure AI Speech voices via `GET /api/v1/live/moments/{id}/voice` when `AZURE_SPEECH_KEY` is set, the browser voice otherwise), compete on the live leaderboard, and download a **1600×1200 Full-Time Tactical Report PNG** with badges at the final whistle (`MATCH_END`). |
| **2. Key Moments Challenge** (`Play this moment`) | Switch to **Key moments & Voice** → click **Play this moment** | On-demand 30-second tactical challenge on any of the 7 key moments (`POST /api/v1/game/evaluate`). Scores your move against the engine's two-player optimum, reveals the optimal pass and movement vectors on the pitch, and triggers the engine-verified, audience-personalised pundit reveal. |
| **3. Voice What-If & Tactical Sandbox** (`Key moments & Voice`) | Switch to **Key moments & Voice** in the top bar | Speak natural-language tactical instructions in English or Spanish via microphone (`POST /api/v1/speech/transcribe` → `POST /api/v1/agents/what-if`, e.g., *"Que el lateral cierre por dentro y el central salga a presionar"* / *"Tuck the full-back inside and press with #5"*), or drag up to 2 players (`MAX_VOICE_MOVES = 2`) on the 120×80 m board. Spoken commands smoothly animate 1 or 2 players across the pitch (`650 ms` cubic ease-out) and automatically trigger spoken pundit commentary. Also includes the **Auto-Coach** inverse defensive optimiser (`POST /api/v1/optimizer/solve`), side-by-side **Scenario Comparator**, and **1600×1200 PNG Export**. |
| **4. Cloud Telemetry & Chaos Engineering** (`Infrastructure`) | Click **Infrastructure** in the top bar | Inspect the gateway's KEDA replica count (read from Azure Monitor) and the circuit breaker (the AKS pod and model-latency figures are estimates while those services are off); trigger a **25-simulation parallel KDTree stress burst** (`POST /api/v1/cloud/stress-burst`); or inject an **AKS Chaos Outage** (`POST /api/v1/cloud/chaos-toggle`) to test zero-downtime Circuit Breaker fallback. |

### 2. Four Audience Personalisation Modes (`casual`, `analyst`, `coach`, `audio_description`)
Chosen during **Onboarding** and selectable at any time in the top-right **Profile Switcher** in **Key Moments & Voice** mode (during **Live Match**, the top bar keeps the view focused by showing only the **Language (`EN`/`ES`)** and **Audio Mute/Unmute** controls with instant speech pause/resume):
- **Casual fan (`casual`)**: Plain words, zero jargon; Expected Threat is expressed as goal probability percentages (*"danger rises from 18% to 26%"*).
- **Analyst (`analyst`)**: Full quantitative readout — $\Delta\text{xT}$ on the $16\times12$ grid, Gaussian pass completion cones, and $60\times40$ Voronoi control.
- **Coach (`coach`)**: Dressing-room verdict (*validated* / *rejected*) and actionable tactical coaching cues (interior channel lock, cover shadows, rest-defence spacing).
- **Audio description (`audio_description`)**: Spoken-first spatial narration for blind and low-vision fans (*"on the right wing, about 25 metres from goal, attacking left to right"*), with neural TTS paced 10% slower.

---

## 🏛️ System Architecture: Azure Container Apps (AKS workers optional)

One backend image runs in several roles, selected by the `SERVICE_ROLE` environment variable. The same code runs as a single process locally and as separate services on Azure:

```mermaid
flowchart TD
    BROWSER["Browser<br/>Next.js 15 UI · SVG pitch 120×80 m"]

    subgraph ACAENV ["Azure Container Apps environment · HTTPS only, HTTP/2 + WebSocket"]
        FRONT["xt-whatif-frontend<br/>Next.js · 1–5 replicas"]
        GATEWAY["xt-whatif-aca-gateway<br/>SERVICE_ROLE=aca-gateway · LIVE_ENABLED=false<br/>simulate · optimiser · game preview/evaluate · voice what-if · TTS/STT · MCP · telemetry · chaos"]
        KEDA["KEDA HTTP scale rule<br/>20 concurrent requests per replica · 1–10 replicas"]
        LIVE["xt-whatif-live<br/>live match room · WS /ws/live · /api/v1/live/*<br/>exactly 1 replica"]
        KEDA -.-> GATEWAY
    end

    subgraph AKS ["Azure Kubernetes Service (optional)"]
        SVC["xt-whatif-aks-worker-svc<br/>LoadBalancer :8000 (X-Worker-Token)"]
        WORKERS["xt-whatif-aks-worker pods<br/>SERVICE_ROLE=aks-worker<br/>xT · Voronoi (KDTree) · pass cones · moment Validator"]
        HPA["HPA v2<br/>CPU 65 % · 3–12 pods"]
        HPA -.-> WORKERS
    end

    subgraph SHARED ["Shared Azure resources"]
        ACR["Azure Container Registry<br/>admin user disabled"]
        MI["User-assigned managed identity<br/>AcrPull + Monitoring Reader"]
        LOGS["Log Analytics workspace"]
        AOAI["Azure OpenAI (optional, off in the demo)<br/>GPT-4o · GPT-4o-mini · gpt-4o-mini-tts · whisper-1"]
        SPEECH["Azure AI Speech (optional, key not set in the demo)<br/>neural TTS voices + Fast Transcription STT"]
    end

    BROWSER -->|"HTTPS"| FRONT
    BROWSER <-->|"REST /api/v1/* · WS /ws/match/{id}"| GATEWAY
    BROWSER <-->|"WS /ws/live · GET /api/v1/live/*"| LIVE
    GATEWAY -->|"POST /api/v1/simulate · 3.5 s timeout"| SVC
    LIVE -->|"2× POST /api/v1/game/optimize (attack + defend)<br/>as events happen · 1.5 s timeout"| SVC
    SVC --> WORKERS
    GATEWAY -.->|"timeout · error · non-200 · chaos toggle<br/>→ compute in-process"| GATEWAY
    LIVE -.->|"timeout · error · non-200 · chaos toggle<br/>→ compute in-process"| LIVE
    GATEWAY <-->|"pundit debate + tool calling · Whisper STT / TTS fallback"| AOAI
    GATEWAY <-->|"neural TTS voices + Fast Transcription STT"| SPEECH
    LIVE <-->|"verified reveal debate"| AOAI
    LIVE <-->|"reveal voice, synthesised while a moment is open"| SPEECH
    MI -.->|"image pull"| ACR
    ACAENV -.->|"container logs"| LOGS
```

### How the pieces fit together
1. **One image, several roles.** The backend image is the same for the gateway (`aca-gateway`), the live match (`SERVICE_ROLE=live`, `LIVE_ENABLED=true`) and the AKS workers (`aks-worker`). Locally, `standalone` runs everything in one process, or `docker compose up --build` mirrors the multi-service layout (`gateway` on `:8000`, `live` on `:8001`, `frontend` on `:3000`).
2. **Event-by-event delegation with in-process fallback.** As synthetic match events happen in the live match (no look-ahead), the singleton `xt-whatif-live` service offloads the moment Validator's two independent searches (`optimize(frame, "attack")` and `optimize(frame, "defend")`) in parallel to the AKS worker pool (`POST /api/v1/game/optimize`, guarded by `X-Worker-Token`, 1.5 s timeout), while `xt-whatif-aca-gateway` forwards counterfactual simulations (`POST /api/v1/simulate`, 3.5 s timeout). If any call times out, fails or returns a non-200 status (or when the chaos toggle is active), the caller runs the same engine in-process and records a circuit-breaker trip.
3. **Scaling.** KEDA scales the gateway on concurrent HTTP requests and the HPA scales the AKS workers on CPU. The live match stays on one replica so every fan sees the same match state, while heavy Validator CPU searches scale across AKS pods.

> **ℹ️ Note on AKS, Azure OpenAI, Azure AI Speech & the Azure for Students subscription:** three parts of the architecture are **fully implemented and tested** in this repository but are **not enabled in the live demo**, because the **Azure for Students** subscription does not allow them (quota and policy restrictions):
> - **AKS workers.** The distributed **Azure Kubernetes Service (AKS)** worker architecture (`SERVICE_ROLE=aks-worker`), Kubernetes manifests ([`infra/k8s-aks-workers.yaml`](infra/k8s-aks-workers.yaml)), parallel HTTP offloading ([`aks_client.py`](backend/app/services/aks_client.py)) and the CI/CD step ([`deploy-azure.yml`](.github/workflows/deploy-azure.yml)) are ready, but the subscription cannot provision AKS node pools. The demo runs on **Azure Container Apps (ACA)** with the built-in **Circuit Breaker / in-process compute fallback** active seamlessly.
> - **Azure OpenAI pundit debate.** The multi-agent debate (tool calling into the engine plus the deterministic numerical verifier, in practice mode and in the live reveal) is ready and tested with a mocked client, but the subscription does not give us a usable chat model deployment. Every debate and reveal in the demo is served by the engine-verified templates in [`narration.py`](backend/app/services/narration.py) (`explanation.generated_by` is `"template"` in the `MOMENT_REVEAL` message). With a subscription that allows it, deploy a chat model with tool calling under the names in [`main.bicep`](infra/main.bicep) (`gpt-4o`, `gpt-4o-mini`) and set the `AZURE_OPENAI_API_KEY` secret.
> - **Azure AI Speech voices.** The neural pundit voices and Fast Transcription ([`tts_service.py`](backend/app/services/tts_service.py)) are ready, but `AZURE_SPEECH_KEY` is not set in the deployed containers, so `POST /api/v1/tts/synthesize` returns `browser-web-speech-fallback` and the browser's Web Speech API reads the pundits.

---

## 🧮 Mathematical Engine Deep-Dive

### 1. Canonical Expected Threat (xT) Bilinear Interpolation
The field is partitioned into an $M \times N = 16 \times 12$ canonical grid ($C = 192$ zones) following Karun Singh's Markovian model. The expected threat for any continuous coordinate $(x, y) \in [0, 120] \times [0, 80]$ is computed using 2D bilinear interpolation:

$$\text{xT}(x, y) = \sum_{i=0}^{1} \sum_{j=0}^{1} \text{xT}_{c+i, r+j} \cdot \Bigl(1 - \frac{\lvert x - x_{c+i} \rvert}{\Delta x}\Bigr) \Bigl(1 - \frac{\lvert y - y_{r+j} \rvert}{\Delta y}\Bigr)$$

The counterfactual delta is given by:

$$\Delta \text{xT} = \text{xT}_{\text{simulated}} - \text{xT}_{\text{base}}$$

### 2. High-Speed Voronoi Space Control ($60 \times 40$ Fine Grid)
To capture spatial dominance in the final third ($x \in [60.0, 120.0]$, $y \in [0.0, 80.0]$), the engine discretizes the area into a $60 \times 40$ matrix ($2,400$ sample points) evaluated against all player coordinates $\mathbf{p}_k$ using `scipy.spatial.KDTree`:

$$\mathcal{V}_k = \lbrace \mathbf{q} \in \mathbb{R}^2 \mid \|\mathbf{q} - \mathbf{p}_k\|_2 < \|\mathbf{q} - \mathbf{p}_j\|_2, \; \forall j \neq k \rbrace$$

$$\text{SpaceControl}_{\text{home}} = \frac{1}{\lvert\mathcal{G}\rvert} \sum_{\mathbf{q} \in \mathcal{G}} \mathbb{I}\Bigl(\arg\min_k \|\mathbf{q} - \mathbf{p}_k\|_2 \in \text{Team}_{\text{home}}\Bigr) \times 100\%$$

*Performance: Sub-2ms vector execution across 2,400 query points.*

### 3. Gaussian Passing Shadow & Expected Value Maximization
Passing lanes are evaluated as a directional cone between ball holder $\mathbf{p}_{\text{ball}}$ and candidate receiver $\mathbf{p}_{\text{target}}$. The interception probability density by defender $\mathbf{d}_m$ at distance $d_{\perp}$ from the trajectory is modeled with distance-widening dispersion $\sigma(t) = \sigma_0 (1 + \alpha d_{\parallel})$:

$$P_{\text{intercept}}(\mathbf{d}_m) = \exp\Bigl( -\frac{d_{\perp}(\mathbf{d}_m)^2}{2\,\sigma(d_{\parallel})^2} \Bigr)$$

$$P_{\text{pass}} = \prod_{m \in \text{Defenders}} \bigl( 1 - P_{\text{intercept}}(\mathbf{d}_m) \bigr)$$

The engine dynamically recommends the **optimal alternative receiver** (`optimal_pass_target_id`) by maximizing Expected Value:

$$k^* = \arg\max_{k \in \text{Teammates}} \bigl( P_{\text{pass}}(\mathbf{p}_k) \times \text{xT}(\mathbf{p}_k) \bigr)$$

### 4. Quadratic Physical Inertia Penalty
When a user drags a player beyond realistic reaction envelopes ($\Delta d > 6.0\,\text{m}$), a biomechanical recovery penalty is applied to avoid teleportation artifacts:

$$\text{Penalty}_{\text{inertia}} = \beta \cdot \max(0, \Delta d - 6.0)^2, \quad \beta = 0.008$$

$$\text{xT}_{\text{simulated}} = \max(0.02, \; \text{xT}_{\text{raw}} - \text{Penalty}_{\text{inertia}})$$

---

## 🧪 Synthetic Match Data

All data is **synthetic and football-realistic**, generated by [`backend/app/services/synthetic_generator.py`](backend/app/services/synthetic_generator.py) and [`backend/app/services/full_match.py`](backend/app/services/full_match.py). No real clubs, players or match feeds are used.

- **Fixture:** Redmoor Albion vs Saltmarsh Rovers (fictional), match id `900001`, seed `7`. Same seed, same match.
- **Full freeze-frames:** all 22 players plus the ball in every moment, in 120×80 coordinates with the team in possession attacking towards x = 120.
- **Role-based shapes:** the attacking side sets up in a 4-3-3 (rest-defence centre-backs, high full-backs, wingers holding width, striker on the last line); the defending side in a compact 4-5-1 block that stays goal-side and shifts towards the ball.
- **Scenario templates:** wide carry, counter-attack through ball, cut-back, half-space pass, switch of play, edge-of-box shot and 1v1. Each fixes the ball path and which roles carry and receive.
- **Realistic details:** the nearest defender presses the carrier at an angle, the action is played through a gap (defenders are kept off the ball's path), Gaussian positional noise and a 1.8 m minimum spacing.
- **Consistent metrics:** xT, pass probability and space control are computed with the same engine used for counterfactuals, so an untouched moment always has ΔxT = 0.

Moments in the default match:

| # | Clock | Event | Moment | In possession | Base xT |
|:-:|:-----:|:-----:|:-------|:--------------|:-------:|
| **1** | **5:03** | Shot | Shot from the edge of the box | Saltmarsh Rovers (I. Kowalin) | 0.10 |
| **2** | **19:10** | Shot | One-on-one with the keeper | Saltmarsh Rovers (Z. Ombrell) | 0.11 |
| **3** | **37:09** | Pass | Switch of play to the far side | Redmoor Albion (D. Okonne) | 0.09 |
| **4** | **45:19** | Dribble | Wide carry into the box | Redmoor Albion (E. Adeyo) | 0.18 |
| **5** | **55:12** | Pass | Through ball into the half-space | Redmoor Albion (M. Ferrant) | 0.25 |
| **6** | **71:48** | Pass | Counter-attack: ball into space | Saltmarsh Rovers (I. Kowalin) | 0.22 |
| **7** | **86:56** | Pass | Cut-back from the byline | Saltmarsh Rovers (Y. Belcourt) | 0.17 |

Regenerate the committed fixtures (backend cache, frontend offline mocks and the offline narration for every language and audience) after changing the generator or the narration:

```bash
cd backend && python -m app.services.synthetic_generator --write
```

`backend/test_synthetic_generator.py` checks determinism, squad and pitch invariants, plausible metrics, and that the committed fixtures are up to date.

---

## 🗣️ Personalisation: Language, Audience & Voice What-If

The challenge asks to *personalize* the explanation. xT-WhatIf does it on two axes, chosen during Onboarding and in the top-right **Profile Switcher** (remembered per browser):

| Axis | Options | What changes |
|:-----|:--------|:-------------|
| **Language** | English (default) · Spanish | Every interface string, recent event badges (`Pass`/`Pase`, `Carry`/`Conducción`, `Shot`/`Disparo`), moment names, both pundits' debate, the exported PNG reports and the commentator voices & voice-command recognition (`en-GB` / `es-ES`). |
| **Audience** | Casual fan · Analyst (default) · Coach · Audio description | How the pundits explain the same numbers. |

- **Casual fan:** plain words, no jargon; xT is told as *"a 10% chance of leading to a goal"*.
- **Analyst:** full metrics — xT on the 16×12 grid, pass probability, Voronoi space control, coordinates.
- **Coach:** a verdict on the adjustment (*validated* / *rejected*) and one actionable coaching point.
- **Audio description:** spoken-first, spatial narration for blind and low-vision fans (*"on the right wing, about 25 metres from goal"*), no symbols or coordinates, read about 10% slower.

**Code calculates, the pundits explain.** All deterministic templates and reveal comparison builders live in [`backend/app/services/narration.py`](backend/app/services/narration.py) and are filled only with numbers computed by the engine. With Azure OpenAI configured, the multi-agent orchestrator ([`backend/app/agents/orchestrator.py`](backend/app/agents/orchestrator.py)) invokes the engine tools (`xt_at`, `simulate_counterfactual`, `optimizer/solve`) and passes the generated commentary through a deterministic numerical verifier ([`backend/app/agents/verifier.py`](backend/app/agents/verifier.py)) that checks every figure against ground truth before serving it (or falls back to the verified template if any number diverges). Azure OpenAI is not enabled on our Azure for Students subscription, so in the public demo the templates answer.

**Natural-Language Voice What-If (`Key moments & Voice` mode):**
- Users can speak into their microphone (`POST /api/v1/speech/transcribe`, backed by **Azure AI Speech Fast Transcription** with a custom football + player-name **Phrase List**, **Azure OpenAI Whisper `whisper-1`**, and browser `SpeechRecognition` fallback) or type a tactical question (`POST /api/v1/agents/what-if`).
- Understands jersey numbers (digits or spoken words like *"el cinco"*, *"#5"*), player names, tactical roles (*full-back/lateral, centre-back/central, holding midfielder/mediocentro, winger/extremo, striker/delantero*), and compound 1- or 2-player instructions (strictly capped at **2 moved players** per moment, `MAX_VOICE_MOVES = 2`).
- Smoothly animates the interpreted player moves on the pitch (`650 ms` cubic ease-out) and automatically plays the spoken reaction from **Dr. Voronoi** and **Coach Bianchi**.

API examples:

```bash
# Key moments with labels and pre-move debate in Spanish, for casual fans
curl "http://localhost:8000/api/v1/match/900001/frames?lang=es&audience=casual"

# Counterfactual with the debate written for coaches
curl -X POST http://localhost:8000/api/v1/simulate -H "Content-Type: application/json" \
  -d '{"match_id": 900001, "event_uuid": "...", "modified_players": [...], "language": "en", "audience": "coach"}'

# Natural-language Voice / Text What-If (supports 1 or 2 player moves)
curl -X POST http://localhost:8000/api/v1/agents/what-if -H "Content-Type: application/json" \
  -d '{"query": "Que el lateral cierre por dentro y el central salga a presionar", "match_id": 900001, "language": "es", "audience": "coach"}'
```

The WebSocket takes the same profile as query parameters: `ws://localhost:8000/ws/match/900001?lang=es&audience=audio_description` (and `ws://localhost:8001/ws/live?user_id=...&nickname=...&team=home&lang=es&audience=analyst` for the live match room). Both `POST /api/v1/tts/synthesize` and `POST /api/v1/speech/transcribe` accept `language` too.

---

## 🗂️ Repository Structure & API Overview

```text
xT-WhatIf/
├── backend/
│   ├── app/
│   │   ├── agents/          # Multi-agent orchestrator, tool registry, numerical verifier & NL What-If parser
│   │   ├── core/            # Settings (Pydantic) & sliding-window per-client rate limiter
│   │   ├── data/cache/      # Committed synthetic match freeze-frames (match 900001)
│   │   ├── mcp/             # Model Context Protocol (MCP) server (stdio + HTTP JSON-RPC 2.0)
│   │   ├── schemas/         # Canonical 120×80m Pydantic models & live room contracts
│   │   ├── services/        # Tactical math (xT, Voronoi KDTree, Gaussian cones), optimizer, game & live engine,
│   │   │                    # AKS client, cloud telemetry, synthetic generator, narration & TTS/STT service
│   │   └── main.py          # FastAPI entrypoint, REST routes & WebSocket manager
│   ├── scripts/             # WebSocket live match load tester (live_load_test.py)
│   └── test_*.py            # 10 comprehensive test suites (math, agents, MCP, game, live, TTS/STT, cloud, hardening)
├── frontend/
│   └── src/
│       ├── app/             # Next.js 15 App Router dashboard & runtime config endpoint
│       ├── components/      # 2D SVG Tactical Pitch, Live/Challenge cards, Voice What-If, Auto-Coach,
│       │                    # Cloud Telemetry modal, Scenario Comparator, PNG Report exporters & Onboarding
│       ├── hooks/           # Match engine, Live match WS, Challenge timer, Broadcast TTS & Full-time report hooks
│       ├── lib/             # API/WS client, client-side Voronoi/xT fallback, i18n (EN/ES) & voice parser
│       └── mocks/           # Offline fallback fixtures & pre-generated multi-audience narrations
├── contracts/               # Shared API contract models & JSON schema v1
├── infra/                   # Azure Bicep IaC (main.bicep) & AKS worker + HPA manifests (k8s-aks-workers.yaml)
├── docs/                    # Cloud deployment, smoke-test & rehearsal guide (DEPLOY.md)
└── docker-compose.yml       # Local multi-service orchestration (gateway :8000, live :8001, frontend :3000)
```

---

## ⚡ Quickstart: Local Orchestration

### Prerequisites
- Docker & Docker Compose (or Python 3.11+ and Node.js 20+)

### Single-Command Boot
```bash
docker compose up --build
```

Access the applications:
- **Frontend Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Gateway FastAPI Interactive Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Live Match Service**: `http://localhost:8001/api/v1/live/state` · WebSocket `ws://localhost:8001/ws/live`
- **Match Sandbox WebSocket**: `ws://localhost:8000/ws/match/900001`
- **Cloud Architecture Telemetry**: [http://localhost:8000/api/v1/cloud/telemetry](http://localhost:8000/api/v1/cloud/telemetry)

---

## 🧪 Interactive Telemetry & Chaos Engineering (For Judges)

The gateway exposes endpoints to inspect its state and to trigger the AKS fallback during a demo:

### 1. View Live Cluster Telemetry
```bash
curl http://localhost:8000/api/v1/cloud/telemetry
```
*Returns simulation counters, cache hit ratios, KEDA concurrency targets, and Circuit Breaker status. On Azure, the gateway replica count is read from Azure Monitor (`"simulated": false`); locally it is estimated. AKS pod and CPU figures are always estimated from the request load.*

### 2. Inject AKS Chaos Outage (Live Pitch Demo)
```bash
curl -X POST http://localhost:8000/api/v1/cloud/chaos-toggle
```
*Simulates an AKS outage. While it is on, the gateway and live match service skip the AKS call and compute every simulation and moment Validator search in-process, so client requests and live moments keep running without interruption. The flag switches itself off after 90 seconds (`CHAOS_AUTO_RESET_SECONDS`).*

### 3. Run KDTree Parallel Stress Burst (25 Parallel Simulations)
```bash
curl -X POST http://localhost:8000/api/v1/cloud/stress-burst
```
*Executes 25 parallel spatial simulations using `asyncio.gather`. Reports total elapsed time and throughput (>800 simulations/sec).*

---

## ☁️ Azure Cloud Native Integration

This is the project's entry for the **Best Azure Cloud Native Integration** category, which the [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) describe as the use of *"Azure cloud-native services (AKS, Azure Container Apps, Functions, Logic Apps, and AI-optimized data platforms)"*.

### Technologies named in the hackathon rules

| Technology | Where the rules name it | How xT-WhatIf uses it | Status |
|:-----------|:------------------------|:----------------------|:-------|
| **Azure Container Apps** | Cloud Native category | Hosts the frontend, the API gateway (scaled by KEDA, 1–10 replicas) and the live match service (1 replica). | Deployed by the Bicep template |
| **Azure Kubernetes Service (AKS)** | Cloud Native category | Runs geometry and optimiser workers (`SERVICE_ROLE=aks-worker`) behind a LoadBalancer service guarded by `X-Worker-Token`, scaled by an HPA from 3 to 12 pods. **As synthetic match events happen in real time** (no look-ahead), the singleton `xt-whatif-live` service offloads the moment Validator's `attack` and `defend` searches in parallel (`POST /api/v1/game/optimize`, 1.5 s timeout) to the AKS worker pool, and the gateway offloads counterfactual simulations (`POST /api/v1/simulate`). If AKS times out, fails or chaos mode is toggled on, both services fall back to in-process computation with identical results. | Optional: the manifest and the CI step are ready; they run when `AKS_ENABLED` is set and both backend apps receive `aksWorkerUrl` and `aksWorkerToken` |
| **Azure AI Services: Azure OpenAI** | Judging criteria (*"Azure Apps and AI Services"*) | GPT-4o and GPT-4o-mini write the two pundits' debate and live/practice challenge reveals using function calling: the model calls the engine's tools (`simulate_counterfactual`, `optimizer/solve`, `xt_at`) and a deterministic verifier checks every figure in the text against the engine's output, correcting it or falling back to the template text if a number does not match. Also provides `whisper-1` for Speech-to-Text and `gpt-4o-mini-tts` for Text-to-Speech fallback. Without a key, deterministic templates are used instead. | Implemented and tested; **not enabled in the public demo** (Azure for Students subscription; templates answer) |
| **Azure AI Services: Azure AI Speech** | Judging criteria (*"Azure Apps and AI Services"*) | **TTS & STT:** Neural voices read the pundits out loud (`POST /api/v1/tts/synthesize`): Dr. Voronoi is `en-GB-RyanNeural` / `es-ES-AlvaroNeural`, Coach Bianchi `en-GB-ThomasNeural` / `es-ES-DarioNeural`, with their own pace and pitch in SSML and a slower pace for the audio-description audience. In the live match the reveal is synthesised while the moment is still open and served only once it closes (`GET /api/v1/live/moments/{id}/voice`). For **Voice What-If** (`POST /api/v1/speech/transcribe`), Azure AI Speech Fast Transcription transcribes spoken commands using a custom football + active player-name **Phrase List** (falling back to Azure OpenAI Whisper `whisper-1` and browser Web Speech API). | Implemented; used when `AZURE_SPEECH_KEY` is configured. **Not configured in the public demo**: the browser voice reads the pundits |
| **MCP (Model Context Protocol)** | Judging criteria (*"Azure MCP"*) | The project ships its own MCP server, which exposes the engine's four tools (`simulate_counterfactual`, `optimizer/solve`, `xt_at`, `what_if_natural_language`) to any MCP client over stdio (`python -m app.mcp`) and over HTTP JSON-RPC 2.0 (`/api/v1/mcp`, `/api/v1/mcp/tools`, `/api/v1/mcp/call`). It is not the Azure MCP Server product. | In the repo; runs locally and on the gateway |

### Supporting Azure services

| Service | How xT-WhatIf uses it |
|:--------|:----------------------|
| **Azure Container Registry** | Stores the backend and frontend images, tagged with the commit SHA. The admin user is disabled. |
| **Managed Identity + Azure RBAC** | A user-assigned managed identity with the `AcrPull` role on the registry lets the Container Apps pull images without a registry password. The same identity holds `Monitoring Reader` on the gateway to read its metrics. |
| **Log Analytics** | Receives the container logs of the Container Apps environment. |
| **Azure Monitor** | `GET /api/v1/cloud/telemetry` reads the gateway's `ReplicaCount` metric from Azure Monitor with the managed identity, so `aca_gateway_replicas` shows how many replicas KEDA is running (`"simulated": false` in the response). Locally, or if the query fails, it falls back to an estimate and returns `"simulated": true`. |
| **Bicep (Azure Resource Manager)** | Describes every Azure resource above in one template ([`infra/main.bicep`](infra/main.bicep)). |

### How the category's criteria map to the project

The rules ask for *"effective integration of Azure services, event-driven architectures, automation, operational excellence, and AI capabilities"*:

- **Scalable:** KEDA scales the gateway on concurrent HTTP requests (1–10 replicas); with the optional AKS workers enabled, the HPA scales them on CPU.
- **Resilient:** the gateway and live match service fall back to in-process computation when the AKS workers fail, and health probes restart or hold back unhealthy containers.
- **Event-driven:** as each synthetic match event arrives in real time, the live runner triggers parallel `attack` + `defend` Validator searches (on AKS when enabled, in-process otherwise) and pushes match events, key moments and reveals to every fan over WebSockets.
- **Automation:** one Bicep template and one GitHub Actions workflow build, tag and deploy everything.
- **Operational excellence:** a new Container Apps revision per commit SHA, health probes, central logs, per-client rate limits and hardened containers.
- **AI capabilities:** Azure AI Speech neural TTS voices and Phrase-List-boosted Fast Transcription STT (implemented; the key is not set in the public demo, so the browser voice is used). Azure OpenAI with tool calling and number verification is implemented but not enabled in the public demo because of the Azure for Students subscription (templates answer instead).

### Implementation details

Each row describes what is deployed and links to the file that defines it.

| Area | What is deployed | Defined in |
|:-----|:-----------------|:-----------|
| **Compute** | Three Container Apps in one managed environment: `xt-whatif-frontend` (1–5 replicas), `xt-whatif-aca-gateway` (1–10 replicas) and `xt-whatif-live` (exactly 1 replica, holds the shared live match). | [`infra/main.bicep`](infra/main.bicep#L221) |
| **Autoscaling** | The gateway uses a KEDA HTTP scale rule with a target of 20 concurrent requests per replica. The optional AKS workers use an HPA v2 targeting 65 % CPU, from 3 to 12 pods. | [`main.bicep`](infra/main.bicep#L303), [`k8s-aks-workers.yaml`](infra/k8s-aks-workers.yaml#L153) |
| **Fallback** | When `aksWorkerUrl` is set, the live match service offloads the two Validator searches (`POST /api/v1/game/optimize` for `attack` and `defend` in parallel, 1.5 s timeout, authenticated with `X-Worker-Token`) as candidate events happen, and the gateway calls `POST /api/v1/simulate` (3.5 s timeout). On timeout, connection error, non-200 status or bad payload, they run the engine in-process and increment `circuit_breaker_trips`. | [`aks_client.py`](backend/app/services/aks_client.py), [`game_api.py`](backend/app/services/game_api.py), [`main.py`](backend/app/main.py#L167) |
| **Chaos toggle** | `POST /api/v1/cloud/chaos-toggle` forces the fallback path on both the gateway and the live match service. It resets itself after 90 s and is rate-limited to 12 calls per client per minute. | [`main.py`](backend/app/main.py#L280), [`rate_limit.py`](backend/app/core/rate_limit.py#L24) |
| **Registry & identity** | Azure Container Registry with the admin user disabled. All three apps pull images with a user-assigned managed identity that holds the `AcrPull` role, so no registry password is stored. | [`main.bicep`](infra/main.bicep#L68) |
| **Secrets** | The Azure OpenAI key, Azure AI Speech key, and `AKS_WORKER_TOKEN` are Container Apps secrets referenced by the apps (`secretRef`) and Kubernetes secrets on AKS (`aks-worker-token`). Without an OpenAI key, the app uses deterministic templates. | [`main.bicep`](infra/main.bicep#L137), [`k8s-aks-workers.yaml`](infra/k8s-aks-workers.yaml#L73) |
| **Ingress** | External HTTPS only (`allowInsecure: false`), `transport: auto` for HTTP/2 and WebSockets. Backend CORS accepts only the frontend's own address. | [`main.bicep`](infra/main.bicep#L63) |
| **Container hardening** | Both images run as a non-root user. AKS worker pods also run with UID 10001, a read-only root filesystem, all Linux capabilities dropped, no privilege escalation and the `RuntimeDefault` seccomp profile; `/tmp` and the cache folder are `emptyDir` volumes. | [`backend/Dockerfile`](backend/Dockerfile#L23), [`frontend/Dockerfile`](frontend/Dockerfile#L52), [`k8s-aks-workers.yaml`](infra/k8s-aks-workers.yaml#L38) |
| **Health checks** | Liveness and readiness probes on `/health` for both backend Container Apps and the AKS pods. AKS rolls out with `maxUnavailable: 0`. | [`main.bicep`](infra/main.bicep#L197), [`k8s-aks-workers.yaml`](infra/k8s-aks-workers.yaml#L26) |
| **Logs** | The Container Apps environment sends container logs to a Log Analytics workspace. In `/api/v1/cloud/telemetry` the gateway replica count comes from Azure Monitor; the AKS pod count and CPU figures are estimated from request load. | [`main.bicep`](infra/main.bicep#L103), [`cloud_telemetry.py`](backend/app/services/cloud_telemetry.py) |
| **Infrastructure as Code** | Bicep creates the registry, identity, role assignment, Log Analytics, the environment and the three apps, and outputs their URLs. A Kubernetes manifest defines the AKS namespace, deployment, LoadBalancer service and HPA. | [`infra/`](infra/) |
| **CI/CD** | [`deploy-azure.yml`](.github/workflows/deploy-azure.yml) runs the backend tests, a TypeScript check and a Next.js build on every push and pull request. A manual run builds both images, tags them with the commit SHA, pushes them to ACR, deploys the Bicep template and, if `AKS_ENABLED` is set, syncs the `aks-worker-token` secret and applies the AKS manifest with the same tag. Each deploy creates a new Container Apps revision. | [`.github/workflows/`](.github/workflows/) |
| **MCP server** | A Model Context Protocol server (JSON-RPC 2.0, stdio + HTTP bridge at `/api/v1/mcp`, `/api/v1/mcp/tools` and `/api/v1/mcp/call`) exposes the engine to external AI agents as four tools: `simulate_counterfactual`, `optimizer/solve`, `xt_at` and `what_if_natural_language`. Start it over stdio with `python -m app.mcp` from `backend/`. | [`backend/app/mcp/server.py`](backend/app/mcp/server.py) |

> **💡 Hybrid Cloud FinOps & Resilient Fallback**: Following Azure Well-Architected Framework cost-optimization principles, our infrastructure decouples the stateless API Gateway (**Azure Container Apps** with KEDA auto-scaling) from the heavy compute worker pool (**Azure Kubernetes Service**). During off-peak evaluation windows or when AKS node pools are scaled to zero for FinOps efficiency, the ACA Gateway's built-in **Circuit Breaker** automatically intercepts timeouts and executes the `KDTree` Voronoi and Markovian $\text{xT}$ matrices in-process with **0% packet loss and sub-15ms latency**. Judges can test this live via the **Infrastructure → Simulate AKS Outage (Chaos Mode)** button in the UI.

Setup, delivery-day steps, smoke tests and the load test are in **[docs/DEPLOY.md](docs/DEPLOY.md)**.

Rehearse the same layout locally:
```bash
docker compose up --build
```

Load-test the live match with real WebSocket fans (from `backend/`):
```bash
python scripts/live_load_test.py --url ws://localhost:8001 --fans 300 --duration 120
```

---

## 🧪 Test Suite Execution

```bash
# Synthetic data generator & full match events
python backend/test_synthetic_generator.py

# Personalised narration (language x audience), TTS & STT (Azure Speech + Whisper + fallback)
python backend/test_narration.py
python backend/test_tts_service.py

# Multi-Agent Orchestrator, numerical verifier, Voice What-If NL & MCP server
python backend/test_agents_and_mcp.py

# Inverse defensive Auto-Coach optimizer
python backend/test_optimizer.py

# Game engine & live match (including AKS Validator offload & circuit breaker)
python backend/test_game_engine.py
python backend/test_live_match.py

# Public demo guardrails (rate limits, input bounds, chaos auto-reset)
python backend/test_hardening.py

# Run Phase 2: Tactical Math & Agent Swarm
python backend/test_phase2.py

# Run Phase 3 & 4: Cloud Dual-Role, Circuit Breaker & Chaos Telemetry
python backend/test_phase3_cloud.py
```

All test suites run in GitHub Actions on every Pull Request and Push to `main`.

---

## 👥 Contributors & Hackathon Team
- **Daniel Blanchard Lobaco** — [@dbl04](https://github.com/dbl04)
- **Enrique Cardiel Gascón** — [@git874417](https://github.com/git874417)
- **Víctor Sierra Vicén** — [@vsier56](https://github.com/vsier56)

*"Inside the Game" Microsoft Hackathon — October 2026 · Powered by synthetic match data & Microsoft Azure Cloud.*
