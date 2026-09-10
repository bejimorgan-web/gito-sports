import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "../db/connection.js";
import { runtimeConfig } from "../config/env.js";

function uploadFilename(value: string) {
  try {
    const pathname = value.startsWith("/") ? value : new URL(value).pathname;
    if (!pathname.startsWith("/uploads/")) return null;
    const filename = path.basename(pathname);
    return filename && filename !== "." && filename !== ".." ? filename : null;
  } catch {
    return null;
  }
}

export function getUploadStorageDiagnostics() {
  const uploadDir = runtimeConfig.uploadDir;
  const exists = fs.existsSync(uploadDir);
  let writable = false;
  let fileCount = 0;
  let totalBytes = 0;

  if (exists) {
    try {
      fs.accessSync(uploadDir, fs.constants.W_OK);
      writable = true;
      for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name === "upload-debug.log") continue;
        const filePath = path.join(uploadDir, entry.name);
        const stats = fs.statSync(filePath);
        fileCount += 1;
        totalBytes += stats.size;
      }
    } catch {
      writable = false;
    }
  }

  const database = getDatabase();
  const references = database.prepare(`
    SELECT logo_url AS value FROM sports WHERE logo_url IS NOT NULL AND logo_url != ''
    UNION ALL SELECT flag_url FROM countries WHERE flag_url IS NOT NULL AND flag_url != ''
    UNION ALL SELECT logo_url FROM hosts WHERE logo_url IS NOT NULL AND logo_url != ''
    UNION ALL SELECT logo_url FROM competitions WHERE logo_url IS NOT NULL AND logo_url != ''
    UNION ALL SELECT logo_url FROM teams WHERE logo_url IS NOT NULL AND logo_url != ''
  `).all() as Array<{ value: string }>;
  const referencedFiles = [...new Set(references.map((row) => uploadFilename(row.value)).filter((value): value is string => Boolean(value)))];
  const missingReferencedFiles = referencedFiles.filter((filename) => !fs.existsSync(path.join(uploadDir, filename)));

  return {
    directory: uploadDir,
    exists,
    writable,
    fileCount,
    totalBytes,
    referencedUploadFiles: referencedFiles.length,
    missingReferencedFiles: missingReferencedFiles.length
  };
}
