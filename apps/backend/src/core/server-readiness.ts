export type ReadinessFlag =
  | "databaseReady"
  | "footballCacheReady"
  | "featureFlagsReady"
  | "analyticsReady";

const readinessFlags: Record<ReadinessFlag, boolean> = {
  databaseReady: false,
  footballCacheReady: false,
  featureFlagsReady: false,
  analyticsReady: false
};

let serverReady = false;
let bootstrapInitialized = false;
let startupFailed = false;

export function setReady(flag: ReadinessFlag) {
  readinessFlags[flag] = true;
}

export function isServerReady() {
  return serverReady && !startupFailed;
}

export function hasStartupFailed() {
  return startupFailed;
}

export function markStartupFailed() {
  startupFailed = true;
  serverReady = false;
}

export function getReadinessStatus() {
  return {
    serverReady,
    readinessFlags: { ...readinessFlags }
  };
}

export function markServerReady() {
  if (startupFailed) return;

  if (!serverReady) {
    serverReady = true;
    console.log("[SERVER READY TRUE]");
  }
}

export function isBootstrapInitialized() {
  return bootstrapInitialized;
}

export function setBootstrapInitialized() {
  bootstrapInitialized = true;
}

/**
 * Run required synchronous startup work before publishing core readiness.
 * A failed attempt resets old flags and remains unavailable until a later
 * successful initialization attempt completes.
 */
export function initializeCoreReadiness(
  initializeDatabase: () => unknown,
  repairFeatureFlags: () => void,
  logFailure: (error: unknown) => void = (error) => console.error("[startup] initial readiness bootstrapping failed", error)
): boolean {
  serverReady = false;
  bootstrapInitialized = false;
  startupFailed = false;
  for (const flag of Object.keys(readinessFlags) as ReadinessFlag[]) {
    readinessFlags[flag] = false;
  }

  try {
    initializeDatabase();
    setReady("databaseReady");
    repairFeatureFlags();
    setReady("featureFlagsReady");
    setReady("analyticsReady");
    setBootstrapInitialized();
    return true;
  } catch (error) {
    markStartupFailed();
    logFailure(error);
    return false;
  }
}

export function allReadinessFlagsReady() {
  return Object.values(readinessFlags).every(Boolean);
}

// The score provider is optional. Its cache may remain unavailable because of
// missing credentials or an upstream outage, but that must not keep database-
// backed product routes (including mobile configuration) in a 503 state.
export function allCoreReadinessFlagsReady() {
  return readinessFlags.databaseReady &&
    readinessFlags.featureFlagsReady &&
    readinessFlags.analyticsReady;
}
