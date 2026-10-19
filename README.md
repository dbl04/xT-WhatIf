# xT-WhatIf
> **Interactive Counterfactual Engine Powered by Multi-Agent AI (StatsBomb 360)**

**xT-WhatIf** es una plataforma avanzada de analítica táctica de fútbol que permite a analistas y cuerpos técnicos explorar escenarios contrafactuales ("¿Qué pasaría si...?") sobre eventos y *freeze-frames* de **StatsBomb 360**. Permite reposicionar jugadores interactivamente sobre la cancha estándar de 120x80, recalcular el Peligro Esperado (**Expected Threat - xT**), el control espacial de Voronoi y presenciar un debate en tiempo real entre dos agentes de IA especializados: **Dr. Voronoi (Científico de Datos)** y **Míster Bianchi (Entrenador Clásico)**.

---

## 📐 Regla Arquitectónica Crítica #1 (Sistema de Coordenadas)

* **Estándar StatsBomb**: 
  * Eje X: `0.0` a `120.0` (de portería a portería).
  * Eje Y: `0.0` a `80.0` (de banda a banda).
  * Origen `(0.0, 0.0)`: Esquina superior izquierda.
* Ni el Backend ni el Frontend inventan otra escala; el Frontend escala visualmente ese 120x80 al tamaño en píxeles de la pantalla vía SVG/Canvas con `viewBox="0 0 120 80"`.

---

## 🔄 Flujos de Datos y Contratos (Single Source of Truth)

1. **Server-to-Client (`MatchFramePayload`)**:
   El paquete completo que el Backend envía al Frontend en cada evento del partido o tras recalcular una simulación.
   Contiene coordenadas del balón, listado de `players: List[PlayerNode]`, `metrics: TacticalMetrics` y `agent_debate: List[AgentMessage]`.

2. **Client-to-Server (`CounterfactualRequest`)**:
   El paquete que el Frontend envía al Backend cuando el usuario pausa y arrastra a uno o varios jugadores.
   Contiene `match_id`, `event_uuid` y `modified_players: List[PlayerNode]`.

---

## 🏗️ Estructura del Proyecto

```text
xT-WhatIf/
├── README.md                       # Documentación del proyecto
├── docker-compose.yml              # Orquestación local (Frontend + Backend + Redis)
├── .env.example                    # Plantilla de variables de entorno
│
├── contracts/                      # FUENTE DE LA VERDAD (Single Source of Truth)
│   ├── schema_v1.json              # Payload JSON realista (Argentina vs Francia 2022)
│   └── api_Models.py               # Modelos maestros Pydantic (MatchFramePayload, etc.)
│
├── backend/                        # Backend (Python 3.11 + FastAPI)
│   ├── Dockerfile
│   ├── pyproject.toml              # fastapi, uvicorn, statsbombpy, pydantic, openai, scipy
│   └── app/
│       ├── main.py                 # Entrypoint FastAPI (REST + WebSockets)
│       ├── core/config.py          # Configuración y variables de entorno
│       ├── schemas/match_contract.py # Modelos Pydantic (copia exacta del contrato)
│       ├── services/
│       │   ├── statsbomb_loader.py # Carga y normalización de StatsBomb 360
│       │   ├── tactical_math.py    # Cálculo de xT (120x80), Voronoi y pases
│       │   └── agent_swarm.py      # Orquestador: Dr. Voronoi vs Míster Bianchi
│       └── data/cache/             # Caché local de partidos
│
├── frontend/                       # Frontend (Next.js 15 + TypeScript + Tailwind)
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   └── page.tsx            # Dashboard interactivo principal
│       ├── types/match.ts          # Interfaces TypeScript (espejo exacto del contrato)
│       ├── mocks/sample_frame.json # Mock oficial de desarrollo offline
│       ├── components/
│       │   ├── pitch/TacticalPitch2D.tsx  # Cancha 120x80 con Drag & Drop y fantasma
│       │   ├── agents/AgentDebateFeed.tsx # Cabina de debate Dr. Voronoi vs Míster Bianchi
│       │   ├── metrics/XtDeltaPanel.tsx   # Panel de telemetría y comparativa ΔxT
│       │   └── controls/PlaybackBar.tsx   # Controles de reproducción y reinicio
│       └── hooks/useMatchSocket.ts        # Gestión de WebSocket y peticiones contrafactuales
│
└── infra/                          # Despliegue en Azure (AKS + ACA)
    ├── main.bicep                  # Plantilla Bicep
    └── k8s-workers.yaml            # Manifiestos de Kubernetes
```

---

## ⚡ Inicio Rápido

### Con Docker Compose:
```bash
docker-compose up --build
```
* **Frontend**: [http://localhost:3000](http://localhost:3000)
* **Backend API & Swagger**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **WebSocket**: `ws://localhost:8000/ws/match/3869685`

---

## 📄 Licencia
MIT License. Proyecto xT-WhatIf.
