import cors from "cors";

export const ELECTRON_PRODUCTION_ORIGIN = "gito://desktop";

const DEFAULT_CORS_ORIGINS = [
  "https://gito-sports.onrender.com",
  ELECTRON_PRODUCTION_ORIGIN,
  "http://localhost:4100",
  "http://127.0.0.1:4100",
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "http://localhost:4201",
  "http://127.0.0.1:4201"
];

const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function parseCorsOrigins(value = process.env.CORS_ORIGINS): string[] {
  const configuredOrigins = (value ?? DEFAULT_CORS_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...configuredOrigins, ELECTRON_PRODUCTION_ORIGIN])];
}

export function isAllowedCorsOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(origin) || localOriginPattern.test(origin);
}

export function createCorsMiddleware(allowedOrigins = parseCorsOrigins()) {
  return cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin, allowedOrigins)) return callback(null, true);
      return callback(null, false);
    }
  });
}
