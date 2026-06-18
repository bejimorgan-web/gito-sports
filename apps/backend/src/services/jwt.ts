import crypto from "node:crypto";

import { env } from "../config/env.js";

interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
  exp: number;
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(unsignedToken: string): string {
  return crypto
    .createHmac("sha256", env.jwtSecret)
    .update(unsignedToken)
    .digest("base64url");
}

export function createAccessToken(payload: Omit<JwtPayload, "exp" | "jti">): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(
    JSON.stringify({
      ...payload,
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8
    })
  );
  const unsignedToken = `${header}.${body}`;

  return `${unsignedToken}.${sign(unsignedToken)}`;
}

export function verifyAccessToken(token: string): JwtPayload | null {
  const [header, body, signature] = token.split(".");

  if (!header || !body || !signature) {
    return null;
  }

  const unsignedToken = `${header}.${body}`;
  const expectedSignature = sign(unsignedToken);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null;
  }

  let payload: JwtPayload;

  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}
