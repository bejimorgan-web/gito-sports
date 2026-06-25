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

export function setReady(flag: ReadinessFlag) {
  readinessFlags[flag] = true;
}

export function isServerReady() {
  return serverReady;
}

export function getReadinessStatus() {
  return {
    serverReady,
    readinessFlags: { ...readinessFlags }
  };
}

export function markServerReady() {
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

export function allReadinessFlagsReady() {
  return Object.values(readinessFlags).every(Boolean);
}
