import fs from "node:fs";
import path from "node:path";

import express from "express";
import multer from "multer";

import { env } from "../config/env.js";

const uploadsRouter = express.Router();
const uploadDirectory = process.env.UPLOAD_DIR ?? path.join("/tmp", "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
const debugLog = path.join(uploadDirectory, "upload-debug.log");
function writeDebug(...parts: any[]) {
  try {
    const line = `[${new Date().toISOString()}] ` + parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    fs.appendFileSync(debugLog, line + "\n");
  } catch (e) {
    // best-effort
    console.error('failed to write upload debug log', e);
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname) || ".png";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
    callback(null, fileName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

uploadsRouter.post(
  "/images",
  (req, res, next) => {
    console.log('[uploads] multer middleware start');
    writeDebug('multer middleware start');
    try {
      writeDebug('request headers', req.headers);
      writeDebug('request content-length', req.headers['content-length']);
    } catch (e) {}
    // Call multer middleware and capture completion / errors
    upload.single("file")(req, res, (err) => {
      console.log('[uploads] multer middleware finished', err ? `err=${err && err.code}` : 'no-err');
      writeDebug('multer middleware finished', err ? (err as any).code ?? String(err) : 'no-err');
      next(err);
    });
  },
  (request, response) => {
    try {
      console.log('[uploads] route handler start');
      writeDebug('route handler start');
      if (!request.file) {
        console.log('[uploads] no file present on request');
        writeDebug('no file present on request');
        response.status(400).json({ error: "file_required", message: "No file was uploaded." });
        return;
      }

      writeDebug('file saved', { filename: request.file.filename, size: request.file.size, path: request.file.path });

      // Basic sanity check: reject files that are clearly truncated (only PNG signature, etc.)
      try {
        const savedSize = request.file.size ?? 0;
        if (savedSize <= 8) {
          // remove the truncated file and return a clear error to the client
          try { fs.unlinkSync(request.file.path); } catch (e) {}
          console.warn('[uploads] rejected truncated upload', { filename: request.file.filename, size: savedSize });
          writeDebug('rejected truncated upload', { filename: request.file.filename, size: savedSize });
          response.status(400).json({ error: 'file_truncated', message: 'Uploaded file appears truncated or empty. Please retry the upload.' });
          return;
        }
      } catch (e) {
        // best-effort; continue if something unexpected happens
      }

      const fileUrl = `${request.protocol}://${request.get("host")}/uploads/${request.file.filename}`;
      console.log('[uploads] responding with file url', fileUrl);
      writeDebug('responding with file url', fileUrl);
      response.status(201).json({ data: { url: fileUrl } });
    } catch (err) {
      console.error('[uploads] route handler error', err);
      writeDebug('route handler error', (err as any)?.stack ?? String(err));
      throw err;
    }
  }
);

export { uploadsRouter };
