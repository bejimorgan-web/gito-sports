import { createApp } from "./app.js";
import { env, runtimeConfig } from "./config/env.js";
import { getDatabase } from "./db/connection.js";
import validateUploadsAtStartup from "./startup/validateUploads.js";
import { ScoreService } from "./services/score-service.js";
import { MobileFeatureService } from "./services/mobile-feature-service.js";
import {
  allReadinessFlagsReady,
  getReadinessStatus,
  markServerReady,
  setBootstrapInitialized,
  setReady
} from "./core/server-readiness.js";
import * as Sentry from "@sentry/node";

console.log("[RUNTIME FILE]", __filename);
console.log("[RUNTIME VERSION]", process.env.NODE_ENV);

let footballServiceInitialized = false;

async function initializeFootballService() {
  if (footballServiceInitialized) {
    console.log('[startup] FOOTBALL initialization already started, skipping duplicate startup call.');
    return false;
  }

  footballServiceInitialized = true;

  console.log('FOOTBALL STARTUP INIT TRIGGERED');
  console.log('API_FOOTBALL_KEY PRESENT =', Boolean(env.apiFootballKey?.trim()));

  if (!env.apiFootballKey?.trim()) {
    console.warn('[startup] FOOTBALL disabled because API_FOOTBALL_KEY is missing or empty.');
    return true;
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
      return true;
    }

    throw new Error('refreshAll did not initialize cache');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('FOOTBALL INIT FAILED ->', message);
    console.error('FOOTBALL INITIAL REFRESH STATUS = fail');
    return false;
  }
}

function markInitialReadiness() {
  try {
    getDatabase();
    setReady("databaseReady");
    MobileFeatureService.repairMobileFeatureFlags();
    setReady("featureFlagsReady");
    setReady("analyticsReady");
    setBootstrapInitialized();
  } catch (error) {
    console.error('[startup] initial readiness bootstrapping failed', error instanceof Error ? error.message : error);
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
  markInitialReadiness();

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "0.0.0.0", async () => {
    console.log(`GiTO backend listening on port ${port}`);

    const footballReady = await initializeFootballService();
    if (footballReady) {
      setReady("footballCacheReady");
    }

    if (allReadinessFlagsReady()) {
      markServerReady();
      console.log('[startup] server is now fully ready');
    } else {
      console.warn('[startup] server initialization completed, but startup readiness flags are not all ready', getReadinessStatus());
    }
  });
})();

