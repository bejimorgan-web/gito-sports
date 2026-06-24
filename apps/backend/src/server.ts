import { createApp } from "./app.js";
import { env, runtimeConfig } from "./config/env.js";
import { getDatabase } from "./db/connection.js";
import validateUploadsAtStartup from "./startup/validateUploads.js";
import { ScoreService } from "./services/score-service.js";
import * as Sentry from "@sentry/node";

const footballStartupConfig = {
  maxRetries: 3,
  retryDelayMs: 5000
};

async function initializeFootballService(attempt = 1) {
  if (attempt === 1) {
    console.log('FOOTBALL STARTUP INIT TRIGGERED');
    console.log('API_FOOTBALL_KEY PRESENT =', Boolean(env.apiFootballKey?.trim()));
  }

  const status = (ScoreService as any).getStatus?.() ?? {
    footballApiEnabled: false,
    cacheInitialized: false,
    lastFetchTime: null,
    lastResponseCount: 0,
    cacheKeys: []
  };

  console.log('[startup] FOOTBALL INIT ATTEMPT ' + attempt + ': cacheInitialized=' + Boolean(status.cacheInitialized));

  try {
    await (ScoreService as any).refreshAll();
    const updated = (ScoreService as any).getStatus?.() ?? status;

    if (updated.cacheInitialized) {
      console.log('FOOTBALL INITIAL REFRESH STATUS = success');
      console.log('[startup] FOOTBALL: initial refresh completed lastFetchTime=' + (updated.lastFetchTime ?? 'null') + ' lastResponseCount=' + updated.lastResponseCount);
      return;
    }

    throw new Error('refreshAll did not initialize cache');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('FOOTBALL INIT FAILED ->', message);

    if (attempt < footballStartupConfig.maxRetries) {
      console.log('FOOTBALL INIT RETRY', attempt + 1, 'IN', footballStartupConfig.retryDelayMs, 'ms');
      setTimeout(() => void initializeFootballService(attempt + 1), footballStartupConfig.retryDelayMs);
      return;
    }

    console.error('FOOTBALL INITIAL REFRESH STATUS = fail');
  }
}

// run lightweight uploads validation before starting the server
validateUploadsAtStartup();

if (runtimeConfig.errorReportingEnabled && runtimeConfig.sentryDsn) {
  Sentry.init({
    dsn: runtimeConfig.sentryDsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    attachStacktrace: true,
  });
}

(async () => {
  const app = createApp();
  getDatabase();

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`GiTO backend listening on port ${port}`);
    initializeFootballService().catch((error) => {
      console.error('[startup] FOOTBALL: initial refresh failed', error instanceof Error ? error.message : error);
    });
  });
})();

