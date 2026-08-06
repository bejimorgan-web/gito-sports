import { IptvRepository } from "../repositories/iptv-repository.js";

export class IptvHealthService {
  static async checkProvider(providerId: string) {
    // Placeholder: perform provider-specific health checks (HTTP connect, auth, sample stream probe)
    // For Phase 1 this is a no-op that returns a healthy status.
    return {
      providerId,
      status: 'unknown',
      checkedAt: new Date().toISOString(),
      details: null
    };
  }

  static startMonitoring() {
    // Start background monitoring in future phases.
    console.info('[iptv-health] monitoring not yet implemented (phase1)');
  }
}
