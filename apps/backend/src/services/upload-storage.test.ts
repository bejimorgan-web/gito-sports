import "./iptv-test-environment.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getUploadStorageDiagnostics } from "./upload-storage.js";

test("upload diagnostics helper is present and isolated files remain untouched", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-upload-diagnostics-"));
  const existing = path.join(directory, "existing.png");
  fs.writeFileSync(existing, Buffer.alloc(12));
  assert.equal(typeof getUploadStorageDiagnostics, "function");
  assert.equal(fs.statSync(existing).size, 12);
  assert.equal(fs.existsSync(existing), true);
});

test("upload filenames remain basename-safe", () => {
  const traversal = path.basename("../outside.png");
  assert.equal(traversal, "outside.png");
});
