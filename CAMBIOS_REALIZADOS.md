# Resumen de Cambios Realizados — xT-WhatIf

Este documento detalla todos los ajustes de interfaz, audio, internacionalización y la nueva funcionalidad de entrada por voz (micrófono) aplicados sobre el proyecto.

---

## 1. Ocultar cuadrados de `ORIGEN` y `DESTINO` (`TARGET`) fuera de jugadas clave
- **Archivo modificado:** [`frontend/src/components/pitch/TacticalPitch2D.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/pitch/TacticalPitch2D.tsx)
- **Detalle del cambio:**
  - En la capa de la rejilla xT (`xtGridLayer`), las celdas de origen (`isOrigin`) y destino (`isDest`) ahora comprueban `!readOnly` antes de resaltarse:
    ```tsx
    const isOrigin = !readOnly && cell.col === originCell.col && cell.row === originCell.row;
    const isDest = !readOnly && destCell && cell.col === destCell.col && cell.row === destCell.row;
    ```
  - Mientras transcurre el partido en directo fuera de una jugada clave (`readOnly === true`), no se dibuja ni el recuadro blanco de `ORIGEN`/`ORIGIN` ni el recuadro verde de `DESTINO`/`TARGET`. Cuando se abre un reto en directo o se entra en el modo de momentos clave, vuelven a mostrarse con normalidad.

---

## 2. Mensaje de «Esperando momento clave» encima del campo en Live Match
- **Archivos modificados:**
  - [`frontend/src/components/pitch/TacticalPitch2D.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/pitch/TacticalPitch2D.tsx)
  - [`frontend/src/lib/i18n.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/lib/i18n.tsx)
  - [`frontend/src/app/page.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/app/page.tsx)
- **Detalle del cambio:**
  - Se ha añadido una barra de estado en la parte superior de la pizarra táctica (`TacticalPitch2D`) que se muestra únicamente cuando `readOnly` es `true` (modo Live Match mientras no hay una jugada clave abierta):
    - **ES:** *"Esperando momento clave · No puedes mover a los jugadores hasta que se abra una jugada clave"*
    - **EN:** *"Waiting for a key moment · Players cannot be moved until a key play opens"*
  - Se ha ajustado el cálculo de altura (`PITCH_CHROME_PX`) en [`page.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/app/page.tsx) para tener en cuenta la altura de este aviso en pantallas grandes sin desbordar el diseño.

---

## 3. Modo de Entrada por Micrófono EXCLUSIVO en el Modo de Momentos Clave
- **Archivos creados y modificados:**
  - [`frontend/src/components/controls/VoiceWhatIfPanel.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/controls/VoiceWhatIfPanel.tsx) *(nuevo)*
  - [`frontend/src/lib/voiceWhatIf.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/lib/voiceWhatIf.ts) *(nuevo)*
  - [`backend/app/agents/what_if_nl.py`](file:///c:/Users/usuario/Desktop/xT-WhatIf/backend/app/agents/what_if_nl.py)
  - [`frontend/src/hooks/useMatchEngine.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/hooks/useMatchEngine.ts)
  - [`frontend/src/app/page.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/app/page.tsx)
  - [`frontend/src/lib/i18n.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/lib/i18n.tsx)
- **Detalle del cambio:**
  1. **Exclusivo del modo de momentos clave (`!isLiveView`):**
     - El panel [`VoiceWhatIfPanel`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/controls/VoiceWhatIfPanel.tsx) se renderiza únicamente cuando el usuario entra en el modo de practicar jugadas clave (`!isLiveView`). No aparece en el modo Live Match.
  2. **Reconocimiento de voz e interpretación táctica (1 o 2 movimientos):**
     - Utiliza la API nativa del navegador (`SpeechRecognition` / `webkitSpeechRecognition`) en el idioma activo (`es-ES` o `en-GB`), mostrando la transcripción en tiempo real mientras el usuario habla e incluyendo un campo de texto de respaldo.
     - Tanto el endpoint backend (`POST /api/v1/agents/what-if` en [`what_if_nl.py`](file:///c:/Users/usuario/Desktop/xT-WhatIf/backend/app/agents/what_if_nl.py)) como el intérprete local de respaldo ([`voiceWhatIf.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/lib/voiceWhatIf.ts)) reconocen dorsales (en cifra o hablados como palabra: *«el cinco»*, *«dorsal 4»*, *«#6»*), nombres de jugadores, roles tácticos (*lateral, central, mediocentro, extremo, delantero*) y direcciones (*cerrar por dentro, abrir a banda, salir a presionar, adelantar la línea, recular, cerrar línea de pase*).
     - Permite mover **1 o 2 jugadores** en una misma orden compuesta (p. ej., *«Que el lateral cierre por dentro y el central salga a presionar»*) o en órdenes sucesivas.
  3. **Límite estricto de 2 movimientos (`MAX_VOICE_MOVES = 2`):**
     - Se mantiene el límite máximo de **2 jugadores movidos** por jugada clave tanto por voz como arrastrando en el campo (`maxFreeMoves={2}` en [`TacticalPitch2D.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/pitch/TacticalPitch2D.tsx)). Si ya se han movido 2 jugadores e intenta moverse un tercero, se muestra un aviso indicando que debe restablecerse la jugada para elegir otros.
  4. **Animación visual de los jugadores y comentarios hablados automáticos:**
     - Al terminar de hablar por micrófono, los jugadores indicados se **desplazan de forma fluida sobre el césped** (`requestAnimationFrame` durante 650 ms con curva *cubic ease-out*) desde su posición actual hasta la nueva coordenada táctica, mostrando su vector de desplazamiento.
     - En cuanto finaliza el movimiento y se recalcula la simulación (`onSimulationComplete` en [`useMatchEngine.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/hooks/useMatchEngine.ts)), **los comentaristas (Dr. Voronoi y Míster Bianchi) hablan automáticamente (`tts.playMessages`)** valorando el movimiento realizado.

---

## 4. Mejoras previas de la sesión (Audio, Comentaristas, Idioma y Cabecera)
- **Selector de público oculto en modo Live:** [`ProfileSwitcher.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/controls/ProfileSwitcher.tsx) recibe `hideAudience={isLiveView}` para mostrar solo el idioma y el botón de sonido durante el partido en directo.
- **Voz de comentaristas natural, concisa y sin paréntesis:** [`narration.py`](file:///c:/Users/usuario/Desktop/xT-WhatIf/backend/app/services/narration.py), [`live_match.py`](file:///c:/Users/usuario/Desktop/xT-WhatIf/backend/app/services/live_match.py) y [`useBroadcastTTS.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/hooks/useBroadcastTTS.ts) utilizan líneas habladas breves (`voronoi_voice`, `bianchi_voice`) independientes del texto de la tarjeta y filtran cualquier expresión entre paréntesis.
- **Silenciar y reanudar voz en tiempo real:** [`useBroadcastTTS.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/hooks/useBroadcastTTS.ts) detiene la locución al pulsar *Mute* y **retoma automáticamente el comentario** al desmutear (`resumableRef`).
- **Traducción de «Últimas jugadas»:** [`match.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/lib/match.ts), [`useLiveMatch.ts`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/hooks/useLiveMatch.ts), [`LiveCards.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/live/LiveCards.tsx) y [`PlaybackBar.tsx`](file:///c:/Users/usuario/Desktop/xT-WhatIf/frontend/src/components/controls/PlaybackBar.tsx) traducen dinámicamente las etiquetas de eventos (`Pass` → `Pase`, `Carry` → `Conducción`, `Shot` → `Disparo`) según el idioma elegido.
