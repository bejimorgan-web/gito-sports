import crypto from "node:crypto";
import { IptvRepository, IptvProviderRow } from "../repositories/iptv-repository.js";
import type { CreateProviderRequest } from "@gito/shared";

function ensureKey() {
  const secret = process.env.IPTV_SECRET_KEY ?? null;
  if (!secret) {
    throw new Error('IPTV_SECRET_KEY not configured');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptCredentials(payload: Record<string, any>): string {
  const key = ensureKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store as base64 iv:tag:data
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptCredentials(blob: string | null) {
  if (!blob) return null;
  const key = ensureKey();
  const parts = blob.split(':');
  if (parts.length !== 3) return null;
  const [ivPart, tagPart, dataPart] = parts;
  if (!ivPart || !tagPart || !dataPart) return null;
  const iv = Buffer.from(ivPart, 'base64');
  const tag = Buffer.from(tagPart, 'base64');
  const data = Buffer.from(dataPart, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  try {
    return JSON.parse(decrypted.toString('utf8'));
  } catch (e) {
    return null;
  }
}

export class IptvProviderService {
  static createProvider(input: CreateProviderRequest) {
    const enc = input.username || input.password ? encryptCredentials({ username: input.username ?? null, password: input.password ?? null }) : null;
    const row: Partial<IptvProviderRow> = {
      name: input.name,
      type: input.type,
      server_url: input.baseUrl,
      encrypted_credentials: enc,
      expires_at: null,
      enabled: 1,
    };

    return IptvRepository.createProvider(row);
  }

  static updateProvider(id: string, patch: Partial<CreateProviderRequest>) {
    const enc = (patch.username || patch.password) ? encryptCredentials({ username: patch.username ?? null, password: patch.password ?? null }) : undefined;
    const dbPatch: Partial<IptvProviderRow> = {
      name: patch.name,
      type: patch.type,
      server_url: patch.baseUrl,
      encrypted_credentials: enc === undefined ? undefined : (enc ?? null),
      expires_at: undefined,
      enabled: undefined
    };

    return IptvRepository.updateProvider(id, dbPatch as any);
  }

  static getProvider(id: string) {
    const row = IptvRepository.getProviderById(id);
    if (!row) return null;
    const creds = decryptCredentials(row.encrypted_credentials);
    return {
      ...row,
      credentials: creds
    };
  }

  static listProviders() {
    const rows = IptvRepository.listProviders();
    return rows.map(r => ({ ...r, credentials: decryptCredentials(r.encrypted_credentials) }));
  }

  static getProviderCredentials(id: string) {
    const row = IptvRepository.getProviderById(id);
    if (!row) return null;
    const creds = decryptCredentials(row.encrypted_credentials);
    return {
      ...row,
      username: creds?.username ?? null,
      password: creds?.password ?? null,
      credential_username: creds?.username ?? null,
      credential_password: creds?.password ?? null
    };
  }

  static deleteProvider(id: string) {
    return IptvRepository.deleteProvider(id);
  }

  static setProviderStatus(id: string, status: 'active' | 'failed' | 'pending' | 'invalid' | 'inactive') {
    const row: Partial<IptvProviderRow> = {
      enabled: status === 'active' || status === 'pending' || status === 'failed' ? 1 : 0,
      health_status: status === 'failed' ? 'failed' : status === 'inactive' ? 'inactive' : 'unknown'
    };
    return IptvRepository.updateProvider(id, row as any);
  }
}
