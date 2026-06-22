import { Router } from "express";
import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";
import { env } from "../config/env.js";

export const adminRouter = Router();

function getBootstrapTokenFromRequest(request: any): string | null {
  const authHeader = request.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const headerToken = request.headers?.["x-admin-bootstrap-token"];
  if (typeof headerToken === "string") {
    return headerToken.trim();
  }

  return null;
}

adminRouter.post("/create-admin", (request, response) => {
  const configuredToken = env.adminBootstrapToken;
  if (!configuredToken) {
    response.status(403).json({ error: "admin_bootstrap_token_not_configured" });
    return;
  }

  const providedToken = getBootstrapTokenFromRequest(request);
  if (!providedToken || providedToken !== configuredToken) {
    response.status(403).json({ error: "invalid_bootstrap_token" });
    return;
  }

  const email = env.adminEmail;
  const password = env.adminPassword;
  if (!email || !password) {
    response.status(400).json({ error: "admin_email_and_password_required" });
    return;
  }

  try {
    const db = getDatabase();
    const result = ensureAdminOperatorUser(db, email, password);
    response.json({ data: result });
  } catch (error) {
    console.error("[admin/create-admin] failed", error);
    response.status(500).json({ error: "admin_create_failed" });
  }
});

function ensureAdminOperatorUser(database: any, email: string, password: string) {
  const existingUser = database
    .prepare("SELECT id FROM operator_users WHERE email = ?")
    .get(email) as { id: string } | undefined;

  const countRow = database
    .prepare("SELECT COUNT(1) AS count FROM operator_users")
    .get() as { count: number } | undefined;
  const operatorsExisting = Number(countRow?.count ?? 0);

  if (existingUser) {
    return {
      operatorsExisting,
      createdAdmin: false,
      adminEmail: email,
      message: "admin user already exists"
    };
  }

  const { createdAdmin, adminEmail: createdEmail } = insertAdminUserIfAllowed(database, email, password);
  return {
    operatorsExisting,
    createdAdmin,
    adminEmail: createdEmail
  };
}

function insertAdminUserIfAllowed(database: any, email: string, password: string) {
  const now = new Date().toISOString();
  const salt = Buffer.from(crypto.randomBytes(16)).toString("hex");
  const iterations = 310000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  const algo = "pbkdf2_sha256";
  const id = crypto.randomUUID();

  database.prepare(
    `INSERT INTO operator_users (
      id,
      name,
      email,
      role,
      status,
      last_login_at,
      password_hash,
      password_salt,
      password_iterations,
      password_algo,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, "Administrator", email, "admin", "active", null, hash, salt, iterations, algo, now, now);

  return { createdAdmin: true, adminEmail: email };
}
