import React from "react";
import { PALETTE } from "@/lib/palette";

/** Readable text colour (ink or white) on top of a hex fill. */
function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return PALETTE.ink;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? PALETTE.ink : "#ffffff";
}

/**
 * Generic club crest: a plain shield in the kit colour with the short name.
 * Deliberately not a real logo (all clubs in this project are fictional).
 */
export const TeamCrest: React.FC<{ color: string; shortName: string; className?: string }> = ({
  color,
  shortName,
  className,
}) => {
  const text = contrastText(color);
  return (
    <svg viewBox="0 0 100 120" className={className} aria-hidden focusable="false">
      <path
        d="M50 4 L93 17 V56 C93 86 74 104 50 116 C26 104 7 86 7 56 V17 Z"
        fill={color}
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="2"
      />
      <path
        d="M50 13 L85 23.5 V56 C85 80 70 95 50 106 C30 95 15 80 15 56 V23.5 Z"
        fill="none"
        stroke={text}
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <rect x="15" y="34" width="70" height="2" fill={text} fillOpacity="0.35" />
      <text
        x="50"
        y="70"
        textAnchor="middle"
        fill={text}
        fontSize="24"
        fontWeight="800"
        letterSpacing="1"
        style={{ fontFamily: "var(--font-display), 'Arial Narrow', sans-serif" }}
      >
        {shortName}
      </text>
    </svg>
  );
};

export default TeamCrest;
