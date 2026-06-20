import cors from "cors";
import express from "express";
import helmet from "helmet";

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
  
  // JSON middleware with raw body capture for diagnostics
  app.use(express.json({
    limit: "50mb",
    strict: false,
    verify: (req: any, res: any, buf: Buffer) => {
      req.rawBody = buf.toString("utf8");
      req.rawBodyLength = buf.length;
      req.rawBodyHash = require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 16);
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
