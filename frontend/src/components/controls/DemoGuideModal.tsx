"use strict";
"use client";

import React from "react";
import { HelpCircle, X, Play, Move, Sparkles, Camera, Film, ArrowRight } from "lucide-react";

interface DemoGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DemoGuideModal: React.FC<DemoGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const steps = [
    {
      step: "01",
      icon: Film,
      title: "Selecciona una Jugada Clave",
      desc: "Elige entre los 5 Golden Highlights curados de la Final 2022 (ej. Min 35:42 - Gol de Di María o Min 79:15 - Conducción de Mbappé) usando el selector en la barra inferior.",
      color: "text-cyan-400 bg-cyan-950/60 border-cyan-800/60",
    },
    {
      step: "02",
      icon: Play,
      title: "Pulsa 'Play' para la Cinemática 60 FPS",
      desc: "Observa el desplazamiento balístico del balón y las micro-carreras tácticas (1.5m a 3.5m) de receptores atacando el espacio y defensores basculando.",
      color: "text-emerald-400 bg-emerald-950/60 border-emerald-800/60",
    },
    {
      step: "03",
      icon: Move,
      title: "Arrastra a un Defensor (What-If)",
      desc: "Comprueba el anillo de inercia física (6.0m). Si superas los 6.0m verás la alerta de penalización. Observa la caída en ΔxT y la línea cian hacia la 'Opción B Óptima (IA)'.",
      color: "text-amber-400 bg-amber-950/60 border-amber-800/60",
    },
    {
      step: "04",
      icon: Camera,
      title: "Debate IA & Exporta el Scout Report",
      desc: "Pasa el ratón sobre los mensajes de Dr. Voronoi y Míster Bianchi para iluminar a los jugadores analizados. Haz clic en '📸 Exportar Informe Táctico' para descargar la tarjeta 2K en PNG.",
      color: "text-purple-400 bg-purple-950/60 border-purple-800/60",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                🎯 Guía Rápida de Demostración (60s)
              </h3>
              <p className="text-xs text-slate-400">
                Flujo recomendado para jurados de Microsoft y analistas tácticos.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps List */}
        <div className="p-6 space-y-3.5 overflow-y-auto max-h-[75vh]">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            return (
              <div
                key={s.step}
                className="flex items-start gap-4 p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/90 transition hover:border-slate-700"
              >
                <div className={`p-2.5 rounded-xl border shrink-0 ${s.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] font-bold text-slate-500">
                      PASO {s.step}
                    </span>
                    <h4 className="text-sm font-bold text-slate-200">{s.title}</h4>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-slate-950/50">
          <span className="text-[11px] font-mono text-slate-500">
            xT-WhatIf • StatsBomb 360 + Azure Cloud
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/20 active:scale-95 transition"
          >
            ¡Entendido, empezar demo!
          </button>
        </div>
      </div>
    </div>
  );
};

export default DemoGuideModal;
