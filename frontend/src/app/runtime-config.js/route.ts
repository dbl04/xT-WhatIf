// Backend URLs as a tiny script, read from the container's environment on every request
// (see lib/api.ts). Only this route is dynamic: the pages stay statically rendered.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const config = {
    apiUrl: process.env.API_URL || undefined,
    wsUrl: process.env.WS_URL || undefined,
    liveApiUrl: process.env.LIVE_API_URL || undefined,
    liveWsUrl: process.env.LIVE_WS_URL || undefined,
  };
  return new Response(`window.__XT_CONFIG__=${JSON.stringify(config)};`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // A redeploy can change the URLs: never serve a stale copy.
      "Cache-Control": "no-store",
    },
  });
}
