import { Router } from "express";
import crypto from "node:crypto";

import { createAccessToken } from "../services/jwt.js";
import { getDatabase } from "../db/connection.js";

export const authRouter = Router();

authRouter.post("/login", (request, response) => {
  const { email, password } = request.body as { email?: string; password?: string };

  if (!email || !password) {
    response.status(400).json({ error: "email_and_password_required" });
    return;
  }

  const db = getDatabase();
  const row = db.prepare("SELECT id, name, email, role, password_hash, password_salt, password_iterations, password_algo FROM operator_users WHERE email = ?").get(email) as
    | {
        id: string;
        name: string;
        email: string;
        role: string;
        password_hash?: string;
        password_salt?: string;
        password_iterations?: number;
        password_algo?: string;
      }
    | undefined;

  if (!row || !row.password_hash || !row.password_salt) {
    response.status(401).json({ error: "invalid_credentials" });
    return;
  }

  try {
    const iterations = Number(row.password_iterations ?? 310000);
    const salt = row.password_salt as string;
    const expected = row.password_hash as string;
    const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

    if (!crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expected, "hex"))) {
      response.status(401).json({ error: "invalid_credentials" });
      return;
    }
  } catch (err) {
    console.error("[auth] password verification failed", err);
    response.status(500).json({ error: "internal_error" });
    return;
  }

  const operator = { id: row.id, name: row.name, email: row.email, role: row.role };

  response.json({
    data: {
      operator,
      accessToken: createAccessToken({ sub: operator.id, role: operator.role })
    }
  });
});

authRouter.post("/logout", (_request, response) => {
  response.status(204).send();
});
