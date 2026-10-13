import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import express from "express";
import multer from "multer";

import { runtimeConfig } from "../config/env.js";
import { protectedRoute } from "../middleware/protected.js";

const uploadsRouter = express.Router();
const uploadDirectory = runtimeConfig.uploadDir;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: runtimeConfig.imageUploadMaxBytes,
    files: 1
  }
});

function detectImage(buffer: Buffer) {
  const pngEnd = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  if (
    buffer.length >= 57 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.readUInt32BE(8) === 13 && buffer.toString("ascii", 12, 16) === "IHDR" &&
    buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 &&
    buffer.subarray(buffer.length - pngEnd.length).equals(pngEnd)
  ) {
    return { extension: ".png", contentType: "image/png" };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    return { extension: ".jpg", contentType: "image/jpeg" };
  }
  if (
    buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.readUInt32LE(4) === buffer.length - 8 && buffer.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16)) &&
    buffer.readUInt32LE(16) <= buffer.length - 20
  ) {
    return { extension: ".webp", contentType: "image/webp" };
  }
  return null;
}

uploadsRouter.post(
  "/images",
  protectedRoute,
  (request, response, next) => upload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ error: "image_too_large", message: `Images must be ${(runtimeConfig.imageUploadMaxBytes / (1024 * 1024)).toFixed(1)} MB or smaller.` });
      return;
    }
    next(error);
  }),
  (request, response) => {
    if (!request.file || !request.file.buffer.length) {
      response.status(400).json({ error: "file_required", message: "Choose an image to upload." });
      return;
    }

    const image = detectImage(request.file.buffer);
    if (!image) {
      response.status(415).json({ error: "unsupported_image", message: "Choose a valid JPEG, PNG, or WebP image." });
      return;
    }

    const filename = `${randomUUID()}${image.extension}`;
    const filePath = path.join(uploadDirectory, filename);
    fs.writeFileSync(filePath, request.file.buffer, { flag: "wx" });
    response.status(201).json({ data: { url: `/uploads/${filename}`, contentType: image.contentType } });
  }
);

export { uploadsRouter };
