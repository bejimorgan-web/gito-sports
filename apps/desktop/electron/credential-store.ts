import fs from "node:fs";
import path from "node:path";
import { validateCredentialWrite } from "./desktop-storage.js";

export interface SafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface CredentialStore {
  set(ref: string, username: string, password: string): void;
  get(ref: string): { username: string; password: string } | null;
  delete(ref: string): void;
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, { username: string; password: string }>();

  set(ref: string, username: string, password: string) {
    validateCredentialWrite({ ref, username, password });
    this.values.set(ref, { username, password });
  }

  get(ref: string) {
    return this.values.get(ref) ?? null;
  }

  delete(ref: string) {
    this.values.delete(ref);
  }
}

type EncryptedCredential = { encryptedBytes: number[] };

export class SafeStorageCredentialStore implements CredentialStore {
  private readonly filePath: string;
  private readonly encryption: SafeStorageApi;

  constructor(filePath: string, encryption: SafeStorageApi) {
    this.filePath = filePath;
    this.encryption = encryption;
  }

  set(ref: string, username: string, password: string) {
    validateCredentialWrite({ ref, username, password });
    if (!this.encryption.isEncryptionAvailable()) throw new Error("os_credential_store_unavailable");
    const values = this.read();
    values[ref] = {
      encryptedBytes: Array.from(this.encryption.encryptString(JSON.stringify({ username, password })))
    };
    this.write(values);
  }

  get(ref: string) {
    if (!this.encryption.isEncryptionAvailable()) throw new Error("os_credential_store_unavailable");
    const value = this.read()[ref];
    if (!value) return null;
    const decoded = this.encryption.decryptString(Buffer.from(value.encryptedBytes));
    const parsed = JSON.parse(decoded) as { username?: unknown; password?: unknown };
    if (typeof parsed.username !== "string" || typeof parsed.password !== "string") throw new Error("os_credential_store_corrupt");
    return { username: parsed.username, password: parsed.password };
  }

  delete(ref: string) {
    const values = this.read();
    delete values[ref];
    this.write(values);
  }

  private read() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(raw) as Record<string, EncryptedCredential>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("os_credential_store_read_failed");
    }
  }

  private write(values: Record<string, EncryptedCredential>) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(values), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }
}
