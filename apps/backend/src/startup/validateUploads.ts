import fs from 'node:fs';
import path from 'node:path';
import { runtimeConfig } from '../config/env.js';

export function validateUploadsAtStartup() {
  try {
    const uploadDirectory = runtimeConfig.uploadDir;
    fs.mkdirSync(uploadDirectory, { recursive: true });
    if (!fs.existsSync(uploadDirectory)) return;

    const files = fs.readdirSync(uploadDirectory).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
    const truncated: string[] = [];
    files.forEach((f) => {
      try {
        const p = path.join(uploadDirectory, f);
        const stat = fs.statSync(p);
        // treat files <= 8 bytes as truncated / invalid
        if (stat.size <= 8) {
          truncated.push(f);
        }
      } catch (e) {
        // best-effort: continue
      }
    });

    if (truncated.length) {
      console.warn('[startup] detected truncated upload files (preserved):', truncated);
    }
  } catch (e) {
    console.error('[startup] validateUploadsAtStartup failed', e);
  }
}

export default validateUploadsAtStartup;
