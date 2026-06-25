import { createApp } from "./app.js";
import { env, runtimeConfig } from "./config/env.js";
import { getDatabase } from "./db/connection.js";
import validateUploadsAtStartup from "./startup/validateUploads.js";
import { ScoreService } from "./services/score-service.js";
import { MobileFeatureService } from "./services/mobile-feature-service.js";
import * as Sentry from "@sentry/node";

let footballServiceInitialized = false;

async function initializeFootballService() {
  if (footballServiceInitialized) {
    console.log('[startup] FOOTBALL initialization already started, skipping duplicate startup call.');
    return;
  }

  footballServiceInitialized = true;

  console.log('FOOTBALL STARTUP INIT TRIGGERED');
  console.log('API_FOOTBALL_KEY PRESENT =', Boolean(env.apiFootballKey?.trim()));

  if (!env.apiFootballKey?.trim()) {
    console.warn('[startup] FOOTBALL disabled because API_FOOTBALL_KEY is missing or empty.');
    return;
  }

  const status = (ScoreService as any).getStatus?.() ?? {
    footballApiEnabled: false,
    cacheInitialized: false,
    lastFetchTime: null,
    lastResponseCount: 0,
    cacheKeys: []
  };

  console.log('[startup] FOOTBALL INIT: cacheInitialized=' + Boolean(status.cacheInitialized));

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
  MobileFeatureService.repairMobileFeatureFlags();

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`GiTO backend listening on port ${port}`);
    initializeFootballService().catch((error) => {
      console.error('[startup] FOOTBALL: initial refresh failed', error instanceof Error ? error.message : error);
    });
  });
})();

