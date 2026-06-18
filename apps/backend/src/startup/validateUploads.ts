import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

export function validateUploadsAtStartup() {
  try {
    const uploadDirectory =
      process.env.UPLOAD_DIR ??
      (path.dirname(env.databasePath).startsWith("/data")
        ? path.join("/tmp", "uploads")
        : path.join(path.dirname(env.databasePath), 'uploads'));
    fs.mkdirSync(uploadDirectory, { recursive: true });
    if (!fs.existsSync(uploadDirectory)) return;

    const files = fs.readdirSync(uploadDirectory).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
    const removed: string[] = [];
    files.forEach((f) => {
      try {
        const p = path.join(uploadDirectory, f);
        const stat = fs.statSync(p);
        // treat files <= 8 bytes as truncated / invalid
        if (stat.size <= 8) {
          try { fs.unlinkSync(p); removed.push(f); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        // best-effort: continue
      }
    });

    if (removed.length) {
      console.warn('[startup] removed truncated upload files:', removed);
    }
  } catch (e) {
    console.error('[startup] validateUploadsAtStartup failed', e);
  }
}

export default validateUploadsAtStartup;
