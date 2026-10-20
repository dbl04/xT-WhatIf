/** Backend base URL. Set NEXT_PUBLIC_API_URL at build time for deployed environments. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
