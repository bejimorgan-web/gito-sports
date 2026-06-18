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
import { env } from "./config/env.js";

export function createApp() {
  const app = express();

  const uploadDirectory =
    process.env.UPLOAD_DIR ??
    (path.dirname(env.databasePath).startsWith("/data")
      ? path.join("/tmp", "uploads")
      : path.join(path.dirname(env.databasePath), "uploads"));
  fs.mkdirSync(uploadDirectory, { recursive: true });

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/uploads",
    helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }),
    express.static(uploadDirectory)
  );
  app.use("/upload", uploadsRouter);

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
  app.use(workflowErrorHandler);

  return app;
}
