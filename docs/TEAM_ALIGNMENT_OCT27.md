# xT What-If: Team Alignment, Bug Analysis & Implementation Guide (Oct 27)

> **Audience**: Development Team (Daniel, Víctor, Enrique) and AI Coding Agents (LLMs).  
> **Status**: Production Deployed & CI Green | Target Category: **Best Azure Cloud Native Integration**  
> **Repository**: [github.com/dbl04/xT-WhatIf](https://github.com/dbl04/xT-WhatIf)  
> **Deployment URLs**:
> - **Frontend (Production Web)**: `https://xt-whatif-frontend.graydesert-cc4befb9.francecentral.azurecontainerapps.io`
> - **Gateway API**: `https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io`
> - **MCP Server**: `https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io/api/v1/mcp/tools`
> - **Telemetry**: `https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io/api/v1/cloud/telemetry`

---

## 1. Executive Summary & Team Contributions Recap (Oct 25 – Oct 27)

All major architectural branches have been merged into `main` (commits up to `9c35f95`). The system is fully operational in France Central on Azure Container Apps with automated GitHub Actions CI/CD.

### Víctor (Persona 2 — Backend & AI Agent Swarm)
1. **Azure AI Speech Neural TTS**:
   - Implemented in `backend/app/services/tts_service.py` with multi-language neural models (`en-US-JennyMultilingualNeural`, `es-ES-ElviraNeural`).
   - Added transparent fallback to browser Web Speech API with warning headers and telemetry logging if API limits or latencies exceed tolerance.
2. **AKS Live Validator & Circuit Breaker**:
   - Microservice client in `backend/app/services/aks_client.py`.
   - Offloads compute-heavy counterfactual simulations (`simulate_counterfactual`) to a dedicated AKS worker pool when active.
   - Built-in circuit breaker falls back to the in-process engine within 100ms if the AKS endpoint is unavailable.
3. **Pre-synthesized Reveal Commentary**:
   - Pundit debate audio for the reveal state is pre-synthesized in the background during the 30-second challenge countdown, eliminating audio latency upon submission.
4. **Cloud Telemetry**:
   - Real replica counts and cluster health querying via Azure Monitor REST API with ISO UTC intervals.

### Enrique (Persona 3 — Frontend, Animation & Tactical Model)
1. **Animated Reveal Replay (`useRevealReplay.ts`)**:
   - Replays "Your Move" vs "Optimal Move" side-by-side with smooth player disc gliding and animated ball trajectory.
2. **Procedural Web Audio SFX (`sfx.ts`)**:
   - Added whistle, tactical click, positive xT gain, and offside penalty sounds without external audio assets.
3. **Full-Time Match Report (`FullTimeReportModal.tsx`)**:
   - Summary modal at match completion with PNG export (canvas-based) for social media sharing.
4. **22-Player Pass Model Recalibration**:
   - Recalibrated spatial decay ($\sigma = 10.5$), defender interception zones (minimum 0.12 threshold per defender), and strict geometric offside validation.

---

## 2. Deep-Dive Diagnosis & Technical Specifications for Remaining 7 Points

This section provides the exact technical analysis, affected source files, line numbers, and implementation instructions for both human engineers and AI agents.

---

### Bug 1: Frontend Text Overflow & Clipping in Small Containers

#### Problem Statement
In Spanish (`es`), text strings are 20% to 35% longer than in English (e.g., *"Simulación en vivo"*, *"Probabilidad de intercepción"*). Containers with fixed dimensions (`h-8`, `max-w-[300px]`, or `truncate` without accessible tooltips) clip text or cause layout shifts on mobile or split screens.

#### Affected Files
- `frontend/src/components/controls/PlaybackBar.tsx` (Lines 154–173)
- `frontend/src/components/challenge/ChallengeCards.tsx` (`ChallengeStrip`, lines 512–536)
- `frontend/src/components/ui/InfoModal.tsx`
- `frontend/src/lib/i18n.tsx`

#### Implementation Specification
1. In `PlaybackBar.tsx`, change the moment selector wrapper from a rigid `max-w-[300px]` to `min-w-[180px] max-w-[280px] sm:max-w-[340px] flex-1 sm:flex-initial`.
2. Add the native HTML `title` attribute to all truncated text spans so the full name is always visible on hover/touch:
   ```tsx
   <span className="truncate" title={fullText}>{fullText}</span>
   ```
3. In `ChallengeStrip.tsx`, ensure the rule violation text uses `flex-wrap` and responsive font sizing (`text-xs sm:text-sm`) instead of overflowing horizontal bounds.
4. Review Spanish translations in `frontend/src/lib/i18n.tsx` to provide concise, punchy terms for constrained UI elements.

---

### Bug 2: Player Name Overlap in Congested Pitch Areas

#### Problem Statement
In `frontend/src/components/pitch/TacticalPitch2D.tsx` (lines 243–278 & 608–614), `placeNameLabels` computes non-overlapping label rectangles. However, for players with `rank <= 4` (actor, selected, highlighted, modified), `forced: true` is assigned. Line 272 overrides the collision check:
```typescript
else if (forced) dy = LABEL_BELOW;
```
When multiple players congregate in the penalty box or during set pieces, their forced labels render directly on top of neighboring player discs and labels.

#### Implementation Specification
1. **Spatial Proximity Congestion Threshold**: Define a minimum neighbor distance constant:
   ```typescript
   const CONGESTION_RADIUS_M = 3.5;
   ```
2. **Label Suppression Logic**:
   - A player is considered "congested" if another player is within Euclidean distance $< 3.5\text{ m}$.
   - If congested, **suppress the text name label** and display **only the player's circle disc with jersey number**, **UNLESS**:
     - The player is the active `draggingId`.
     - The player is `selectedPlayerId` / hovered.
3. Modify `placeNameLabels` in `TacticalPitch2D.tsx` to accept a `congestedIds: Set<number>` and skip placing labels for congested players unless explicitly focused:
   ```typescript
   const congestedIds = useMemo(() => {
     const set = new Set<number>();
     for (let i = 0; i < renderPlayers.length; i++) {
       for (let j = i + 1; j < renderPlayers.length; j++) {
         const p1 = renderPlayers[i];
         const p2 = renderPlayers[j];
         const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
         if (dist < CONGESTION_RADIUS_M) {
           set.add(p1.player_id);
           set.add(p2.player_id);
         }
       }
     }
     return set;
   }, [renderPlayers]);
   ```
   This guarantees that penalty area scrums remain clean and legible.

---

### Bug 3: Product Strategy — Live Match vs. Practice / Key Moments

#### Problem Statement
Should we keep only the Live Match or also retain the Practice / Key Moments mode?

#### Decision: KEEP BOTH (Crucial for Hackathon Evaluation)
- **Why Live-Only is Dangerous**: In Live mode, the pitch is locked in read-only mode (`readOnly={isLiveView && !inChallenge}`) outside of challenge intervals. Live challenges only open for 30 seconds every 3 to 5 minutes. If a hackathon judge loads the website at minute 14 of the match, the pitch will be non-interactive. The judge may assume the application is broken or lacks interactivity.
- **Why Practice Mode is Essential**: Practice mode lets judges immediately test drag-and-drop counterfactuals, hear AI agent debates, and explore all 7 tactical scenarios on demand without waiting.

#### Implementation Specification
1. Retain **Live Match as the default landing view** to showcase real-time multi-user synchronization and cloud infrastructure.
2. Add a prominent, high-contrast mode switch in the top navigation bar / header:
   ```tsx
   <div className="flex items-center rounded-lg border border-line bg-ink-800 p-0.5">
     <button className={isLiveView ? "active-pill" : "inactive-pill"} onClick={goToLive}>
       <span className="h-2 w-2 rounded-full bg-signal-loss animate-pulse" /> Live Match
     </button>
     <button className={!isLiveView ? "active-pill" : "inactive-pill"} onClick={() => setPractising(true)}>
       🎯 Practice / Key Moments
     </button>
   </div>
   ```
3. When in Live Match mode between challenges, display a polite callout banner:
   *"Next live challenge in Xm Ys. Want to experiment now? [Switch to Practice Sandbox]"*.

---

### Bug 4: Documenting AKS Implementation vs. Azure Budget Limits

#### Problem Statement
The team fully engineered an AKS worker pool deployment (`infra/k8s-aks-workers.yaml`, `backend/app/services/aks_client.py`), but running an active AKS cluster 24/7 costs \$70–\$90/month, which would exhaust the team's \$100 student credit before the evaluation window closes (Nov 10).

#### Strategy: Frame as Senior Cloud Native FinOps & Resiliency
Cloud architects are evaluated on cost optimization and graceful degradation. Having a code-complete AKS architecture with a verified **Circuit Breaker** fallback to Azure Container Apps is an asset, not a deficiency.

#### Implementation Specification
1. **Update `README.md`**:
   - Add a dedicated **Hybrid Cloud Architecture & FinOps** section.
   - Include a Mermaid diagram illustrating:
     `Client -> ACA Gateway -> [Circuit Breaker (100ms)] -> AKS Worker Pool (Primary)` with fallback to `ACA Local In-Process Engine (Resilient Fallback)`.
   - State clearly: *"To preserve the hackathon's \$100 Azure sponsorship budget across the 3-week public evaluation window, the live gateway operates in verified ACA Fallback mode, with the complete AKS cluster manifest available in `infra/k8s-aks-workers.yaml`."*
2. **Update `CloudTelemetryModal.tsx`**:
   - Add an architectural status badge:
     ```tsx
     <div className="rounded-md border border-signal-gain/30 bg-signal-gain/10 p-2.5">
       <span className="font-semibold text-fg">AKS Worker Pool: Code-Complete & Verified</span>
       <p className="text-xs text-fg-muted mt-1">
         Configured via infra/k8s-aks-workers.yaml. Running in ACA Resilient Fallback to preserve sponsorship credits for continuous public evaluation.
       </p>
     </div>
     ```
3. **Submission Form**: Highlight this pattern as evidence of production-grade Cloud Native integration.

---

### Bug 5: README Polish & Hackathon Requirements Verification

#### Problem Statement
`README.md` contains outdated placeholders (`<FRONTEND_URL>`, `<GATEWAY_URL>`, broken badge pointing to `deploy-azure.yml`), and lacks explicit mapping to the **Best Azure Cloud Native Integration** criteria.

#### Implementation Specification
1. Update URLs with the live Azure production endpoints:
   - Frontend: `https://xt-whatif-frontend.graydesert-cc4befb9.francecentral.azurecontainerapps.io`
   - Gateway: `https://xt-whatif-aca-gateway.graydesert-cc4befb9.francecentral.azurecontainerapps.io`
2. Fix the CI badge URL to point to `.github/workflows/deploy.yml`.
3. Add the **Azure Cloud Native Compliance Matrix**:

| Hackathon Requirement | Implementation in Repository |
| :--- | :--- |
| **Infrastructure as Code (IaC)** | `infra/main.bicep`, `infra/aca.bicep`, `infra/acr.bicep` |
| **Managed Identities & Zero Trust** | ACR Pull via User-Assigned Managed Identity (Admin user disabled) |
| **Microservices & Compute** | Azure Container Apps (`xt-whatif-aca-gateway`, `xt-whatif-frontend`) |
| **Cloud Native Autoscaling** | KEDA HTTP-triggered autoscaling rules in Bicep (`scaleMinReplicas: 1`, `scaleMaxReplicas: 5`) |
| **Kubernetes Worker Pool** | `infra/k8s-aks-workers.yaml` with dual-mode container (`SERVICE_ROLE=aks-worker`) |
| **Circuit Breaker Pattern** | `backend/app/services/aks_client.py` (100ms failover) |
| **Cloud AI Services** | Azure AI Speech Neural TTS (`en-US-JennyMultilingualNeural`, `es-ES-ElviraNeural`) |
| **Cloud Telemetry & Observability** | Azure Monitor Metrics REST API integration in `backend/app/services/cloud_telemetry.py` |
| **MCP Server Standard** | FastMCP endpoints exposed at `/api/v1/mcp/tools` |

---

### Bug 6: Key Moments Inaccessible on Mobile Devices

#### Problem Statement
In `frontend/src/app/page.tsx` (lines 695–711):
- `PlaybackBar` has class `${isLiveView ? "hidden" : ...}`. On mobile, `isLiveView` is `true` by default, so the bar is hidden.
- The tactical drawer (`isHudDrawerOpen`) containing `PlayMomentCard` is closed by default (`false`) on screens `< lg`.
- As a result, mobile users do not see how to access or play key moments unless they scroll to the bottom of the page and tap the small "Practise the key moments" button.

#### Implementation Specification
1. **Mobile Quick Action Bar**:
   In `frontend/src/app/page.tsx`, directly below the pitch or sticky at the bottom on mobile screens (`lg:hidden`), render a compact control strip:
   - If in Live mode: Show current match clock, a button to open the leaderboard, and a clear button: **"🎯 Probar Jugadas Clave"**.
   - If in Practice mode: Show a compact mobile moment carousel/selector (Previous, Dropdown, Next) so the user can switch scenarios without needing the full desktop transport bar.
2. In `page.tsx`, ensure `isHudDrawerOpen` auto-opens when a user switches to Practice mode on mobile, or render `PlayMomentCard` directly beneath the pitch.

---

### Bug 7: Origin and Destination Squares in Defensive Scenarios

#### Problem Statement
In `frontend/src/components/pitch/TacticalPitch2D.tsx` (lines 750–774):
When the xT grid is active, `originCell` (ball origin) and `destCell` (ball end) are highlighted.
In a **defensive scenario** (where the opponent has possession and the user is repositioning defenders to prevent a goal or intercept):
1. `destCell` is highlighted in bright green (`C.gain`) and labeled **"TARGET" / "DESTINO"**.
2. **UX Ambiguity**: In defense, that square is the *attacker's* target zone. Showing a green square labeled "TARGET" in the user's defensive penalty area confuses users into thinking *they* should play the ball there, when their actual objective is to mark and defend it.
3. If an action is a dribble or defensive recovery without a pass destination (`event_type !== 'Pass'`), rendering a destination square is tactically incorrect.

#### Implementation Specification
1. In `TacticalPitch2D.tsx`, detect whether the current frame/challenge is defensive:
   ```typescript
   const isDefensive = challenge?.mode === "defensive";
   ```
2. **Conditional Label and Styling**:
   - If `isDefensive`:
     - Label: `t("pitch.dangerZone")` (*"AMENAZA RIVAL"* / *"THREAT ZONE"*).
     - Stroke / Fill: Use a warning alert style (e.g., `C.loss` / coral `#ff4d4f` or amber dashed stroke) instead of green.
   - If offensive / normal:
     - Label: `t("pitch.target")` (*"DESTINO"*).
     - Stroke / Fill: Retain bright green (`C.gain`).
3. **Pass Check**: Only render `destCell` if `ballEndX != null && ballEndY != null` AND the event represents a pass or shot with distinct coordinates (`Math.hypot(ballEndX - ballX, ballEndY - ballY) > 2.0`).

---

## 3. Implementation Plan & Work Packages

| Task ID | Component | Description | Primary Files |
| :--- | :--- | :--- | :--- |
| **T1** | Tactical Pitch | Suppress congested player names (< 3.5m); show jersey numbers only. | `TacticalPitch2D.tsx` |
| **T2** | Tactical Pitch | Re-style destination cell for defensive scenarios (Threat Zone in warning color). | `TacticalPitch2D.tsx`, `i18n.tsx` |
| **T3** | Navigation & Mode | Add prominent Live / Practice switcher to header and mobile view. | `page.tsx`, `Header.tsx`, `LiveCards.tsx` |
| **T4** | Mobile UX | Responsive moment selector and challenge controls on `< lg` viewports. | `page.tsx`, `PlaybackBar.tsx`, `ChallengeCards.tsx` |
| **T5** | Telemetry UI | Add AKS architecture status card explaining FinOps fallback mode. | `CloudTelemetryModal.tsx` |
| **T6** | Documentation | Update `README.md` with production URLs, CI badge, Architecture diagram, and Compliance Matrix. | `README.md` |
| **T7** | Verification | Run full frontend lint/build (`npm run build`) and backend tests (`pytest`). | `frontend/`, `backend/` |

---

## 4. Verification Criteria & Smoke Tests

1. **Pitch Density Test**: Load a congested scenario (e.g. `edge_shot` or corner scenario). Verify that nearby defenders only show their numbered discs, without text labels overlapping.
2. **Defensive Challenge Visual Test**: Switch team to Away (Saltmarsh Rovers) to trigger defensive mode. Verify that the opponent's pass target displays as **"AMENAZA RIVAL"** in amber/coral instead of green "DESTINO".
3. **Mobile Responsiveness Test**: Open Chrome DevTools in iPhone 14 / Pixel 7 view. Verify that the user can immediately switch to Practice mode, select any key moment, drag defenders, and trigger evaluation.
4. **Production Build & CI**: Verify that `npm run build` in `frontend/` succeeds with zero TypeScript or JSX errors.
