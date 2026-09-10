import type { CreateProviderRequest } from "@gito/shared";
import * as LegacyProviderRepository from "../repositories/provider-repository.js";

export class IptvProviderService {
  static createProvider(input: CreateProviderRequest) {
    return LegacyProviderRepository.createProvider(input);
  }

  static updateProvider(id: string, patch: Partial<CreateProviderRequest>) {
    return LegacyProviderRepository.updateProvider(id, patch);
  }

  static getProvider(id: string) {
    return LegacyProviderRepository.getProviderById(id);
  }

  static listProviders() {
    return LegacyProviderRepository.listProviders();
  }

  static getProviderCredentials(id: string) {
    return LegacyProviderRepository.getProviderCredentials(id);
  }

  static deleteProvider(id: string) {
    return LegacyProviderRepository.softDeleteProvider(id);
  }

  static setProviderStatus(id: string, status: 'active' | 'failed' | 'pending' | 'invalid' | 'inactive') {
    return LegacyProviderRepository.setProviderStatus(id, status);
  }

  static updateProviderHealth(input: Parameters<typeof LegacyProviderRepository.updateProviderHealth>[0]) {
    return LegacyProviderRepository.updateProviderHealth(input);
  }
}
