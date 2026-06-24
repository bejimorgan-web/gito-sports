import { ApiUsageRepository, ApiUsageType } from "../repositories/api-usage-repository.js";

export type RateLimitConfig = {
  intervalMs: number; // Time between requests in milliseconds
  cacheTtlMs?: number; // How long to cache the result (defaults to intervalMs)
};

export type ApiGuardResult<T> = {
  allowed: boolean;
  cached: boolean;
  data?: T;
  blockedUntil?: number; // Unix timestamp of when the next request will be allowed
  reason: string; // Always provided for diagnostic purposes
};

const DEFAULT_RATE_LIMIT_CONFIGS: Record<ApiUsageType, RateLimitConfig> = {
  live_fixtures: { intervalMs: 30_000, cacheTtlMs: 20_000 }, // 30 sec min interval, 20 sec cache
  fixtures: { intervalMs: 6 * 60 * 60 * 1000, cacheTtlMs: 6 * 60 * 60 * 1000 }, // 6 hours
  logos: { intervalMs: 7 * 24 * 60 * 60 * 1000, cacheTtlMs: 7 * 24 * 60 * 60 * 1000 }, // 7 days
  leagues: { intervalMs: 24 * 60 * 60 * 1000, cacheTtlMs: 24 * 60 * 60 * 1000 } // 24 hours
};

class ApiUsageCache {
  private cache = new Map<string, { data: unknown; expiry: number }>();

  set<T>(key: string, data: T, ttlMs: number): void {
    const expiry = Date.now() + ttlMs;
    this.cache.set(key, { data, expiry });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

export class ApiUsageGuard {
  private cache = new ApiUsageCache();
  private customConfigs: Map<ApiUsageType, RateLimitConfig> = new Map();
  private inFlight = new Map<string, Promise<ApiGuardResult<unknown>>>();
  private currentApiCall: Promise<void> | null = null;

  /**
   * Set custom rate limit config for a request type.
   */
  setRateLimitConfig(requestType: ApiUsageType, config: RateLimitConfig): void {
    this.customConfigs.set(requestType, config);
  }

  /**
   * Get the rate limit config for a request type.
   */
  private getConfig(requestType: ApiUsageType): RateLimitConfig {
    return this.customConfigs.get(requestType) ?? DEFAULT_RATE_LIMIT_CONFIGS[requestType];
  }

  /**
   * Check if a request is allowed, and optionally cache the result.
   *
   * @param requestType - Type of API request (e.g., "live_fixtures")
   * @param cacheKey - Unique key for caching result (e.g., "live_fixtures_default")
   * @param fn - Async function to call if request is allowed
   * @returns Promise with allowed flag, cached flag, and result data
   *
   * @example
   * const result = await apiGuard.checkAndExecute(
   *   'live_fixtures',
   *   'live_fixtures_default',
   *   () => ApiFootballService.getLiveFixtures()
   * );
   *
   * if (!result.allowed) {
   *   console.log('API REQUEST BLOCKED', result.reason);
   *   return result.data; // cached data
   * }
   *
   * console.log('API REQUEST SENT');
   * // Use result.data (fresh from API)
   */
  async checkAndExecute<T>(
    requestType: ApiUsageType,
    cacheKey: string,
    fn: () => Promise<T>
  ): Promise<ApiGuardResult<T>> {
    const inFlightKey = `${requestType}:${cacheKey}`;
    if (this.inFlight.has(inFlightKey)) {
      return this.inFlight.get(inFlightKey)! as Promise<ApiGuardResult<T>>;
    }

    const requestPromise = (async (): Promise<ApiGuardResult<T>> => {
      const config = this.getConfig(requestType);
      const now = Date.now();

      // Check in-memory cache first
      const cachedData = this.cache.get<T>(cacheKey);
      if (cachedData !== null) {
        console.log(`[API CACHE HIT] ${requestType} (${cacheKey})`);
        return {
          allowed: false,
          cached: true,
          data: cachedData,
          reason: "In-memory cache hit"
        };
      }

      // Check database for last request timestamp
      const lastRequestTimestamp = ApiUsageRepository.getLastRequestTimestamp(requestType);
      const timeSinceLastRequest = lastRequestTimestamp ? now - lastRequestTimestamp : null;
      const isAllowed =
        lastRequestTimestamp === null || timeSinceLastRequest === null || timeSinceLastRequest >= config.intervalMs;

      if (!isAllowed && timeSinceLastRequest !== null) {
        const blockedUntil = lastRequestTimestamp! + config.intervalMs;
        console.log(
          `[API REQUEST BLOCKED] ${requestType} (${cacheKey}) - Next request allowed at ${new Date(blockedUntil).toISOString()}`
        );

        // Try to return cached data
        const cachedData = this.cache.get<T>(cacheKey);
        if (cachedData !== null) {
          return {
            allowed: false,
            cached: true,
            data: cachedData,
            blockedUntil,
            reason: `Rate limit exceeded. Next request allowed in ${Math.ceil((blockedUntil - now) / 1000)}s`
          };
        }

        // No cached data available
        return {
          allowed: false,
          cached: false,
          blockedUntil,
          reason: `Rate limit exceeded. No cached data available.`
        };
      }

      // Request is allowed, execute the function
      console.log(`[API REQUEST SENT] ${requestType} (${cacheKey})`);
      let externalApiCall: Promise<T> | null = null;
      let pendingApiCall: Promise<void> | null = null;

      try {
        if (this.currentApiCall) {
          await this.currentApiCall.catch(() => {
            // Ignore errors from other in-flight requests when serializing.
          });
        }

        externalApiCall = fn();
        pendingApiCall = externalApiCall.then(() => {}).catch(() => {});
        this.currentApiCall = pendingApiCall;

        const data = await externalApiCall;
        const cacheTtl = config.cacheTtlMs ?? config.intervalMs;
        this.cache.set(cacheKey, data, cacheTtl);
        ApiUsageRepository.updateLastRequestTimestamp(requestType, now);

        return {
          allowed: true,
          cached: false,
          data,
          reason: "Request sent successfully"
        };
      } catch (error) {
        console.error(`[API REQUEST ERROR] ${requestType} (${cacheKey}):`, error);
        throw error;
      } finally {
        if (pendingApiCall && this.currentApiCall === pendingApiCall) {
          this.currentApiCall = null;
        }
      }
    })();

    this.inFlight.set(inFlightKey, requestPromise as Promise<ApiGuardResult<unknown>>);
    try {
      return await requestPromise;
    } finally {
      this.inFlight.delete(inFlightKey);
    }
  }

  /**
   * Clear all caches (in-memory and optionally database).
   */
  clearCache(clearDatabase: boolean = false): void {
    this.cache.clear();
    if (clearDatabase) {
      ApiUsageRepository.clearAll();
    }
  }

  /**
   * Get current API usage status.
   */
  getStatus(): Record<string, { lastRequest?: number; nextAllowedAt?: number }> {
    const status: Record<string, { lastRequest?: number; nextAllowedAt?: number }> = {};

    const requestTypes: ApiUsageType[] = ["live_fixtures", "fixtures", "logos", "leagues"];

    for (const requestType of requestTypes) {
      const lastRequest = ApiUsageRepository.getLastRequestTimestamp(requestType);
      const config = this.getConfig(requestType);

      status[requestType] = {};
      if (lastRequest) {
        status[requestType].lastRequest = lastRequest;
        status[requestType].nextAllowedAt = lastRequest + config.intervalMs;
      }
    }

    return status;
  }
}

// Export singleton instance
export const apiUsageGuard = new ApiUsageGuard();
