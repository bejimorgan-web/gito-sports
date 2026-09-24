import fs from "node:fs";
import path from "node:path";
import { validateCredentialWrite } from "./desktop-storage.js";
export class MemoryCredentialStore {
    values = new Map();
    set(ref, username, password) {
        validateCredentialWrite({ ref, username, password });
        this.values.set(ref, { username, password });
    }
    get(ref) {
        return this.values.get(ref) ?? null;
    }
    delete(ref) {
        this.values.delete(ref);
    }
}
export class SafeStorageCredentialStore {
    filePath;
    encryption;
    constructor(filePath, encryption) {
        this.filePath = filePath;
        this.encryption = encryption;
    }
    set(ref, username, password) {
        validateCredentialWrite({ ref, username, password });
        if (!this.encryption.isEncryptionAvailable())
            throw new Error("os_credential_store_unavailable");
        const values = this.read();
        values[ref] = {
            encryptedBytes: Array.from(this.encryption.encryptString(JSON.stringify({ username, password })))
        };
        this.write(values);
    }
    get(ref) {
        if (!this.encryption.isEncryptionAvailable())
            throw new Error("os_credential_store_unavailable");
        const value = this.read()[ref];
        if (!value)
            return null;
        const decoded = this.encryption.decryptString(Buffer.from(value.encryptedBytes));
        const parsed = JSON.parse(decoded);
        if (typeof parsed.username !== "string" || typeof parsed.password !== "string")
            throw new Error("os_credential_store_corrupt");
        return { username: parsed.username, password: parsed.password };
    }
    delete(ref) {
        const values = this.read();
        delete values[ref];
        this.write(values);
    }
    read() {
        try {
            const raw = fs.readFileSync(this.filePath, "utf8");
            return JSON.parse(raw);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return {};
            throw new Error("os_credential_store_read_failed");
        }
    }
    write(values) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(values), { mode: 0o600 });
        fs.renameSync(temporaryPath, this.filePath);
    }
}
