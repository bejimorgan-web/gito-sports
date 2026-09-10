import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gito-backup-test-"));
process.env.NODE_ENV = "test";
process.env.GITO_NEWS_TEST_MODE = "true";
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.DATABASE_PATH = path.join(testRoot, "gito.sqlite");
process.env.BACKUP_DIR = path.join(testRoot, "backups");
process.env.MAX_BACKUPS = "20";
process.env.BACKUP_INTERVAL_MS = "86400000";

const { allowSqliteInstantiation, DatabaseSync } = await import("../db/sqlite.js");
const { createBackup, enforceBackupRetention, getBackupStats } = await import("./database-backup-service.js");

function createValidDatabase() {
  const database = allowSqliteInstantiation(() => new DatabaseSync(process.env.DATABASE_PATH!));
  database.exec("CREATE TABLE IF NOT EXISTS fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL);");
  database.prepare("INSERT INTO fixture (value) VALUES (?)").run("backup-test");
  database.close();
}

function createBackups(count: number) {
  fs.mkdirSync(process.env.BACKUP_DIR!, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const filename = `gito-backup-2026-09-10-00-${String(index).padStart(2, "0")}.sqlite`;
    const target = path.join(process.env.BACKUP_DIR!, filename);
    fs.copyFileSync(process.env.DATABASE_PATH!, target);
    const timestamp = new Date(Date.UTC(2026, 8, 10, 0, index));
    fs.utimesSync(target, timestamp, timestamp);
  }
}

test("retention reduces 43 valid backups to 20 and preserves unrelated files", async () => {
  createValidDatabase();
  createBackups(43);
  const unrelated = path.join(process.env.BACKUP_DIR!, "restore-test.sqlite");
  fs.copyFileSync(process.env.DATABASE_PATH!, unrelated);

  const result = await enforceBackupRetention(process.env.BACKUP_DIR);
  const managed = fs.readdirSync(process.env.BACKUP_DIR!).filter((filename) => filename.startsWith("gito-backup-") && filename.endsWith(".sqlite"));

  assert.equal(result.scanned, 43);
  assert.equal(result.deleted.length, 23);
  assert.equal(managed.length, 20);
  assert.equal(fs.existsSync(unrelated), true);
  assert.equal(fs.existsSync(path.join(process.env.BACKUP_DIR!, "gito-backup-2026-09-10-00-42.sqlite")), true);
});

test("backup creation is single-flight and reports retention diagnostics", async () => {
  const results = await Promise.allSettled([createBackup(), createBackup()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && String(result.reason).includes("backup_in_progress")).length, 1);

  const stats = await getBackupStats();
  assert.equal(stats.backupCount <= 20, true);
  assert.equal(stats.retention, 20);
  assert.equal(stats.backupInProgress, false);
  assert.equal(typeof stats.totalBackupBytes, "number");
  assert.equal(typeof stats.disk?.freeBytes, "number");
});

test("retention does not delete an invalid-only backup set", async () => {
  const invalidDirectory = path.join(testRoot, "invalid-only");
  fs.mkdirSync(invalidDirectory, { recursive: true });
  const invalidPath = path.join(invalidDirectory, "gito-backup-2026-09-10-01-00.sqlite");
  fs.writeFileSync(invalidPath, "not a sqlite database");

  const result = await enforceBackupRetention(invalidDirectory);

  assert.equal(result.skipped, true);
  assert.equal(result.deleted.length, 0);
  assert.equal(fs.existsSync(invalidPath), true);
});
