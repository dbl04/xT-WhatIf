"use strict";
"use client";

import React from "react";
import { Button, ModalShell } from "@/components/ui/primitives";

interface DemoGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: "Elige una jugada clave",
    desc: "Selecciona uno de los momentos clave del partido sintético (un contraataque, un pase atrás, un mano a mano…) en el selector del dock inferior.",
  },
  {
    title: "Reproduce la secuencia",
    desc: "Pulsa Play para ver el recorrido del balón y las micro-carreras de 1,5 a 3,5 m: receptores atacando el espacio y defensores basculando.",
  },
  {
    title: "Arrastra a un defensor",
    desc: "Fíjate en el anillo de inercia de 6,0 m: si lo superas se marca en magenta y se penaliza el xT. Observa el Δ xT y la línea verde hacia la opción de pase óptima.",
  },
  {
    title: "Escucha el análisis y exporta",
    desc: "El lower-third resume la lectura del Dr. Voronoi y de Míster Bianchi e ilumina a los jugadores citados. Usa Exportar para descargar el informe en PNG.",
  },
];

export const DemoGuideModal: React.FC<DemoGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <ModalShell
      kicker="Guía rápida · 60 s"
      title="Cómo usar xT-WhatIf"
      description="Flujo recomendado para una demostración en directo."
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            Datos sintéticos · Azure
          </span>
          <Button variant="primary" onClick={onClose}>
            Empezar
          </Button>
        </>
      }
    >
      <ol className="divide-y divide-line">
        {STEPS.map((s, idx) => (
          <li key={s.title} className="flex gap-5 px-5 py-4">
            <span className="w-8 shrink-0 font-display text-[32px] font-bold leading-none tabular-nums text-fg-subtle">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold uppercase leading-tight tracking-wide text-fg">
                {s.title}
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{s.desc}</p>
            </div>
          </li>
        ))}
      </ol>
    </ModalShell>
  );
};

export default DemoGuideModal;
