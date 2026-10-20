"use client";

import React from "react";
import { motion } from "framer-motion";
import { AgentRole } from "@/types/match";

interface AvatarProps {
  isSpeaking?: boolean;
  size?: number;
  className?: string;
}

export const DrVoronoiAvatar: React.FC<AvatarProps> = ({
  isSpeaking = false,
  size = 84,
  className = "",
}) => {
  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Halo reactivo exterior cuando habla */}
      <motion.div
        animate={
          isSpeaking
            ? {
                scale: [1, 1.12, 1],
                opacity: [0.45, 0.85, 0.45],
              }
            : { scale: 1, opacity: 0.2 }
        }
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-cyan-500/40 via-sky-400/20 to-transparent blur-md"
      />

      <svg
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 w-full h-full rounded-2xl border border-cyan-400/40 bg-slate-950/90 shadow-[0_0_25px_rgba(34,211,238,0.25)] overflow-hidden"
      >
        <defs>
          <linearGradient id="voronoiBg" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#020617" />
            <stop offset="60%" stopColor="#082f49" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="hudGlass" x1="30" y1="45" x2="90" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Fondo con malla Voronoi sutil */}
        <rect width="120" height="120" fill="url(#voronoiBg)" />
        <path
          d="M0 30 L35 15 L60 40 L95 20 L120 35 M35 15 L40 0 M60 40 L65 120 M95 20 L110 0"
          stroke="#22d3ee"
          strokeOpacity="0.14"
          strokeWidth="1"
        />

        {/* Hombros / Chaqueta Cyber-Analista */}
        <path
          d="M18 120 C18 93 36 84 60 84 C84 84 102 93 102 120 Z"
          fill="#0f172a"
          stroke="#22d3ee"
          strokeWidth="1.5"
        />
        {/* Cuello alto con nodos de circuito */}
        <path d="M44 82 L48 98 L60 104 L72 98 L76 82 Z" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.2" />
        <circle cx="52" cy="94" r="2" fill="#22d3ee" />
        <circle cx="68" cy="94" r="2" fill="#22d3ee" />

        {/* Cuello y Cabeza estilizada */}
        <rect x="51" y="70" width="18" height="16" rx="6" fill="#cbd5e1" />
        <path
          d="M36 46 C36 28 46 20 60 20 C74 20 84 28 84 46 C84 65 73 77 60 77 C47 77 36 65 36 46 Z"
          fill="#e2e8f0"
        />

        {/* Cabello geométrico */}
        <path
          d="M35 42 C34 25 47 16 62 16 C77 16 86 25 85 40 C81 31 73 27 60 27 C46 27 39 32 35 42 Z"
          fill="#0f172a"
        />

        {/* Gafas HUD Inteligentes (Dr. Voronoi Signature) */}
        <g>
          <rect
            x="33"
            y="43"
            width="54"
            height="15"
            rx="4"
            fill="url(#hudGlass)"
            stroke="#a5f3fc"
            strokeWidth="1.5"
          />
          {/* Telemetría reflejada en el visor */}
          <line x1="38" y1="48" x2="52" y2="48" stroke="#ecfeff" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="38" y1="53" x2="46" y2="53" stroke="#67e8f9" strokeWidth="1.2" strokeLinecap="round" />
          <polygon points="73,47 79,50 73,54" fill="#ecfeff" opacity="0.85" />
          <line x1="60" y1="43" x2="60" y2="58" stroke="#083344" strokeWidth="1.5" />
        </g>

        {/* Boca / Modulador de voz animado */}
        {isSpeaking ? (
          <motion.rect
            x="52"
            y="65"
            width="16"
            height="4"
            rx="2"
            fill="#06b6d4"
            animate={{ height: [2, 6, 3, 7, 2], y: [66, 64, 65, 63, 66] }}
            transition={{ duration: 0.35, repeat: Infinity }}
          />
        ) : (
          <path d="M53 66 Q60 69 67 66" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
        )}

        {/* Auricular / Micrófono HUD */}
        <path d="M84 52 L90 56 L86 67 L73 67" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="72" cy="67" r="2.5" fill="#22d3ee" />

        {/* Ecualizador en vivo en la esquina inferior */}
        {isSpeaking && (
          <g transform="translate(10, 96)">
            {[0, 1, 2, 3].map((i) => (
              <motion.rect
                key={i}
                x={i * 5}
                y={0}
                width="3"
                rx="1.5"
                fill="#22d3ee"
                animate={{
                  height: [4, 16, 7, 18, 5],
                  y: [14, 2, 11, 0, 13],
                }}
                transition={{
                  duration: 0.45,
                  repeat: Infinity,
                  delay: i * 0.08,
                }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
};

export const MisterBianchiAvatar: React.FC<AvatarProps> = ({
  isSpeaking = false,
  size = 84,
  className = "",
}) => {
  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Halo cálido reactivo cuando habla */}
      <motion.div
        animate={
          isSpeaking
            ? {
                scale: [1, 1.12, 1],
                opacity: [0.45, 0.85, 0.45],
              }
            : { scale: 1, opacity: 0.2 }
        }
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-amber-500/40 via-yellow-400/20 to-transparent blur-md"
      />

      <svg
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 w-full h-full rounded-2xl border border-amber-400/40 bg-slate-950/90 shadow-[0_0_25px_rgba(251,191,36,0.22)] overflow-hidden"
      >
        <defs>
          <linearGradient id="bianchiBg" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#090d16" />
            <stop offset="60%" stopColor="#451a03" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* Fondo con trazos de pizarra táctica clásica */}
        <rect width="120" height="120" fill="url(#bianchiBg)" />
        <circle cx="95" cy="25" r="14" stroke="#fbbf24" strokeOpacity="0.14" strokeWidth="1.2" strokeDasharray="3 3" />
        <path d="M12 22 L28 38 M28 22 L12 38" stroke="#fbbf24" strokeOpacity="0.16" strokeWidth="1.5" />

        {/* Abrigo de Entrenador Clásico & Solapas */}
        <path
          d="M14 120 C14 91 34 82 60 82 C86 82 106 91 106 120 Z"
          fill="#1c1917"
          stroke="#f59e0b"
          strokeWidth="1.5"
        />
        {/* Camisa blanca y Corbata dorada/oscura */}
        <polygon points="48,82 60,108 72,82" fill="#f8fafc" />
        <polygon points="57,86 63,86 64,108 60,113 56,108" fill="#d97706" />
        {/* Solapas del abrigo */}
        <polygon points="36,85 48,82 55,112 32,112" fill="#292524" stroke="#78350f" strokeWidth="1" />
        <polygon points="84,85 72,82 65,112 88,112" fill="#292524" stroke="#78350f" strokeWidth="1" />

        {/* Cuello y Rostro curtido de DT */}
        <rect x="50" y="70" width="20" height="15" rx="6" fill="#e2c8b5" />
        <path
          d="M36 45 C36 27 46 19 60 19 C74 19 84 27 84 45 C84 64 73 77 60 77 C47 77 36 64 36 45 Z"
          fill="#f1d6c3"
        />

        {/* Pelo plateado/canoso clásico de Míster */}
        <path
          d="M34 43 C33 23 45 14 60 14 C75 14 87 23 86 43 C83 31 75 25 60 25 C45 25 37 31 34 43 Z"
          fill="#cbd5e1"
        />
        <path d="M36 28 Q60 20 84 28" stroke="#94a3b8" strokeWidth="2" fill="none" />

        {/* Cejas expresivas y mirada táctica */}
        <path d="M42 43 L54 45" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
        <path d="M78 43 L66 45" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
        <circle cx="48" cy="50" r="2.6" fill="#0f172a" />
        <circle cx="72" cy="50" r="2.6" fill="#0f172a" />

        {/* Líneas de expresión de experiencia */}
        <path d="M43 57 Q48 60 52 57" stroke="#c29d82" strokeWidth="1.2" fill="none" />
        <path d="M68 57 Q72 60 77 57" stroke="#c29d82" strokeWidth="1.2" fill="none" />

        {/* Boca animada cuando da órdenes / habla */}
        {isSpeaking ? (
          <motion.ellipse
            cx="60"
            cy="66"
            rx="7"
            ry="3.5"
            fill="#7c2d12"
            stroke="#f59e0b"
            strokeWidth="1"
            animate={{ ry: [1.5, 4.5, 2, 5, 1.5] }}
            transition={{ duration: 0.32, repeat: Infinity }}
          />
        ) : (
          <path d="M51 66 Q60 64 69 66" stroke="#78350f" strokeWidth="2.4" strokeLinecap="round" />
        )}

        {/* Pin táctico dorado en la solapa */}
        <circle cx="77" cy="98" r="3" fill="#fbbf24" />

        {/* Ecualizador cálido en la esquina inferior */}
        {isSpeaking && (
          <g transform="translate(92, 96)">
            {[0, 1, 2, 3].map((i) => (
              <motion.rect
                key={i}
                x={i * 5}
                y={0}
                width="3"
                rx="1.5"
                fill="#fbbf24"
                animate={{
                  height: [5, 17, 6, 15, 4],
                  y: [13, 1, 12, 3, 14],
                }}
                transition={{
                  duration: 0.4,
                  repeat: Infinity,
                  delay: i * 0.09,
                }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
};

export const CommentatorAvatar: React.FC<{
  role: AgentRole;
  isSpeaking?: boolean;
  size?: number;
}> = ({ role, isSpeaking = false, size = 84 }) => {
  if (role === "data_scientist") {
    return <DrVoronoiAvatar isSpeaking={isSpeaking} size={size} />;
  }
  return <MisterBianchiAvatar isSpeaking={isSpeaking} size={size} />;
};
