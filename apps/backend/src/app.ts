import cors from "cors";
import express from "express";
import helmet from "helmet";
import crypto from "node:crypto";

import { workflowErrorHandler } from "./middleware/workflow-error.js";
import { authRouter } from "./routes/auth.js";
import path from "node:path";
import fs from "node:fs";

import { healthRouter } from "./routes/health.js";
import { systemRouter } from "./routes/system.js";
import { iptvRouter } from "./routes/iptv.js";
import { liveMatchesRouter } from "./routes/live-matches.js";
import { matchesRouter } from "./routes/matches.js";
import { mobileRouter } from "./routes/mobile.js";
import { operationsRouter } from "./routes/operations.js";
import { scoresRouter } from "./routes/scores.js";
import { sportsRouter } from "./routes/sports.js";
import { countriesRouter } from "./routes/countries.js";
import { competitionsRouter } from "./routes/competitions.js";
import { teamsRouter } from "./routes/teams.js";
import { streamsRouter } from "./routes/streams.js";
import { uploadsRouter } from "./routes/uploads.js";
import { eventsRouter } from "./routes/events.js";
import { migrationRouter } from "./routes/migration.routes.js";
import { env } from "./config/env.js";

export function createApp() {
  const app = express();

  const uploadDirectory = process.env.UPLOAD_DIR ?? path.join("/tmp", "uploads");
  fs.mkdirSync(uploadDirectory, { recursive: true });

  app.set("trust proxy", true);
  app.use(helmet());
  // Configure CORS to allow known frontend origins. The list can be
  // configured via the CORS_ORIGINS env variable as a comma-separated
  // list. Defaults include the Render deployment and localhost for dev.
  const corsOriginsEnv = process.env.CORS_ORIGINS ?? "https://gito-sports.onrender.com,http://localhost:4100,http://127.0.0.1:4100";
  const allowedOrigins = corsOriginsEnv.split(",").map(s => s.trim()).filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server).
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS origin not allowed: ${origin}`));
      }
    })
  );

  app.use(
    "/api/admin/migration",
    express.raw({ limit: "50mb", type: () => true })
  );

  app.use(express.json({
    limit: "50mb",
    strict: false,
    type: (req) => {
      const request = req as any;
      const path = request.path ?? request.url ?? "";
      return !path.toString().startsWith("/api/admin/migration") &&
        (request.headers["content-type"] ?? "").toString().toLowerCase().includes("application/json");
    },
    verify: (req, res, buf: Buffer) => {
      const request = req as any;
      request.rawBody = buf.toString("utf8");
      request.rawBodyLength = buf.length;
      request.rawBodyHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    }
  }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(
    "/uploads",
    helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }),
    express.static(uploadDirectory)
  );
  app.use("/upload", uploadsRouter);

  // Migration routes handle auth internally. Bypass any global auth middleware.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin/migration")) {
      console.log("[migration auth bypass]", req.method, req.originalUrl, req.headers.authorization ? "auth header present" : "no auth header");
      return next();
    }
    next();
  });

  app.get("/__debug/migration-auth", (req, res) => {
    res.json({
      env_token: process.env.MIGRATION_IMPORT_TOKEN ?? null,
      auth_header: req.headers.authorization ?? null,
      node_env: process.env.NODE_ENV,
    });
  });

  // Lightweight version & env endpoint to verify deployed code and env vars
  app.get("/__debug/version", (req, res) => {
    let commit: string | null = process.env.RENDER_GIT_COMMIT || process.env.DEPLOY_COMMIT || null;
    try {
      if (!commit) {
        const gitHead = path.resolve(process.cwd(), '.git', 'HEAD');
        if (fs.existsSync(gitHead)) {
          const head = fs.readFileSync(gitHead, 'utf8').trim();
          if (head.startsWith('ref:')) {
            const ref = head.split(' ').pop();
            const refPath = path.resolve(process.cwd(), '.git', ref ?? '');
            if (fs.existsSync(refPath)) commit = fs.readFileSync(refPath, 'utf8').trim();
          } else {
            commit = head;
          }
        }
      }
    } catch (e) {
      // ignore errors reading git information
    }

    res.json({
      commit: commit,
      env_token: process.env.MIGRATION_IMPORT_TOKEN ?? null,
      database_path: process.env.DATABASE_PATH ?? null,
      jwt_secret_present: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 24),
      node_env: process.env.NODE_ENV ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/auth", authRouter);
  app.use("/health", healthRouter);
  app.use("/system", systemRouter);
  app.use("/api/events", eventsRouter);
  app.use("/sports", sportsRouter);
  app.use("/countries", countriesRouter);
  app.use("/competitions", competitionsRouter);
  app.use("/teams", teamsRouter);
  app.use("/matches", matchesRouter);
  app.use("/live-matches", liveMatchesRouter);
  app.use("/mobile", mobileRouter);
  app.use("/operations", operationsRouter);
  app.use("/scores", scoresRouter);
  app.use("/iptv", iptvRouter);
  app.use("/streams", streamsRouter);
  app.use('/api/admin/migration', migrationRouter);
  app.use(workflowErrorHandler);

  return app;
}
