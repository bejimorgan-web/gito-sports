import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { getDatabase } from "./db/connection.js";
import validateUploadsAtStartup from "./startup/validateUploads.js";
import { ScoreService } from "./services/score-service.js";

async function initializeFootballService() {
  const status = (ScoreService as any).getStatus?.() ?? {
    footballApiEnabled: false,
    lastFetchTime: null,
    lastResponseCount: 0,
    cacheKeys: []
  };

  console.log('[startup] FOOTBALL INIT: enabled=' + Boolean(status.footballApiEnabled));
  console.log('[startup] FOOTBALL INIT: cacheInitialized=' + Boolean(status.cacheInitialized));
  console.log('[startup] FOOTBALL INIT: lastFetchTime=' + (status.lastFetchTime ?? 'null'));
  console.log('[startup] FOOTBALL INIT: lastResponseCount=' + status.lastResponseCount);

  if (!status.cacheInitialized || status.cacheKeys === 0) {
    try {
      await (ScoreService as any).refreshAll();
      const updated = (ScoreService as any).getStatus?.() ?? status;
      console.log('[startup] FOOTBALL: initial refresh completed lastFetchTime=' + (updated.lastFetchTime ?? 'null') + ' lastResponseCount=' + updated.lastResponseCount);
    } catch (error) {
      console.error('[startup] FOOTBALL: initial refresh failed', error instanceof Error ? error.message : error);
    }
  }
}

// run lightweight uploads validation before starting the server
validateUploadsAtStartup();

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

