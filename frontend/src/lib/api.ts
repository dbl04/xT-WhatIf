/**
 * Backend addresses, read when the page loads rather than when the bundle is built.
 *
 * In Azure the frontend is deployed before anyone knows the backend's final URL, so
 * `/runtime-config.js` (app/runtime-config.js/route.ts) writes `window.__XT_CONFIG__` from
 * the container's runtime environment (API_URL, WS_URL, LIVE_API_URL, LIVE_WS_URL). The root
 * layout loads it with `beforeInteractive`, so it has run before this module is evaluated.
 * Local development falls back to the NEXT_PUBLIC_* build-time values and then to localhost.
 *
 * Every URL is an origin without a trailing slash; callers add the path
 * (`${WS_BASE_URL}/ws/match/<id>`, `${LIVE_WS_URL}/ws/live`).
 */
export interface RuntimeConfig {
  /** REST gateway (simulations, optimiser, TTS, telemetry). */
  apiUrl: string;
  /** WebSocket origin of the gateway. */
  wsUrl: string;
  /** The single live-match service (preview of live moments). */
  liveApiUrl: string;
  /** WebSocket origin of the live-match service. */
  liveWsUrl: string;
}

declare global {
  interface Window {
    __XT_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const origin = (url: string) => url.replace(/\/+$/, "").replace(/\/ws$/, "");
const toWs = (httpUrl: string) => httpUrl.replace(/^http/, "ws");

function readConfig(): RuntimeConfig {
  const injected = typeof window !== "undefined" ? window.__XT_CONFIG__ ?? {} : {};
  const apiUrl = origin(injected.apiUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");
  const wsUrl = origin(injected.wsUrl || process.env.NEXT_PUBLIC_WS_URL || toWs(apiUrl));
  const liveApiUrl = origin(injected.liveApiUrl || process.env.NEXT_PUBLIC_LIVE_API_URL || apiUrl);
  const liveWsUrl = origin(injected.liveWsUrl || process.env.NEXT_PUBLIC_LIVE_WS_URL || toWs(liveApiUrl));
  return { apiUrl, wsUrl, liveApiUrl, liveWsUrl };
}

export const RUNTIME_CONFIG: RuntimeConfig = readConfig();
export const API_BASE_URL = RUNTIME_CONFIG.apiUrl;
export const WS_BASE_URL = RUNTIME_CONFIG.wsUrl;
export const LIVE_API_URL = RUNTIME_CONFIG.liveApiUrl;
export const LIVE_WS_URL = RUNTIME_CONFIG.liveWsUrl;
