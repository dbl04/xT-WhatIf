/**
 * Font variable tokens and inline font-family definitions used across the broadcast UI and canvas exports.
 * Actual @font-face stylesheets are loaded via Google Fonts in layout.tsx / globals.css
 * so `next build` in CI/Docker never crashes when Google Fonts serves extensionless URLs.
 */
export const displayFont = {
  variable: "font-vars",
  className: "",
  style: { fontFamily: '"Barlow Condensed", Impact, "Arial Narrow", sans-serif' },
};

export const sansFont = {
  variable: "",
  className: "",
  style: { fontFamily: '"Inter", system-ui, sans-serif' },
};

export const monoFont = {
  variable: "",
  className: "",
  style: { fontFamily: '"JetBrains Mono", monospace' },
};
