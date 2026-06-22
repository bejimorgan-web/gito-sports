#!/usr/bin/env node
/**
 * Diagnostic script to analyze migration issues
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || '/tmp/gito.sqlite';

console.log(`\n=== MIGRATION DIAGNOSTICS ===`);
console.log(`Database: ${dbPath}`);
console.log(`Database exists: ${fs.existsSync(dbPath)}`);

const db = new Database(dbPath);

// Get all tables
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
console.log(`\nTables in database: ${tables.length}`);
tables.forEach(t => console.log(`  - ${t.name}`));

// Check critical tables for schema and content
const criticalTables = [
  'operator_users',
  'sports',
  'countries',
  'regions',
  'providers',
  'channels',
  'competitions',
];

console.log(`\n=== CRITICAL TABLE STATUS ===`);
for (const tableName of criticalTables) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get();
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    console.log(`\n${tableName}:`);
    console.log(`  rows: ${count.cnt}`);
    console.log(`  columns: ${columns.map(c => c.name).join(', ')}`);
    
    if (tableName === 'operator_users' && count.cnt > 0) {
      const users = db.prepare(`SELECT id, email, role, password_hash FROM ${tableName}`).all();
      console.log(`  users:${users.map(u => `\n    - ${u.email} (${u.role}) hash=${u.password_hash ? 'present' : 'MISSING'}`)}`);
    }
  } catch (err) {
    console.log(`${tableName}: ERROR - ${err.message}`);
  }
}

// Check for FK violations
console.log(`\n=== FOREIGN KEY VIOLATIONS ===`);
const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
console.log(`Total violations: ${fkViolations.length}`);
if (fkViolations.length > 0) {
  fkViolations.slice(0, 20).forEach(v => {
    console.log(`  ${v.table} rowid ${v.rowid}: refs ${v.parent}(${v.fkid})`);
  });
  if (fkViolations.length > 20) {
    console.log(`  ... and ${fkViolations.length - 20} more`);
  }
}

// Check migration export for comparison
const exportPath = path.resolve(__dirname, '../../..', 'migration-export.json');
console.log(`\n=== MIGRATION EXPORT ANALYSIS ===`);
console.log(`Export file: ${exportPath}`);
console.log(`Export exists: ${fs.existsSync(exportPath)}`);

if (fs.existsSync(exportPath)) {
  try {
    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    const tables = exportData.tables || {};
    console.log(`Export tables: ${Object.keys(tables).length}`);
    
    criticalTables.forEach(tableName => {
      const rows = tables[tableName] || [];
      console.log(`  ${tableName}: ${rows.length} rows`);
    });
    
    console.log(`\nImport order from export:`, exportData.order?.slice(0, 10).join(', '));
  } catch (err) {
    console.log(`Export parse error: ${err.message}`);
  }
}

// Check schema mismatches
console.log(`\n=== SCHEMA ANALYSIS ===`);
const countriesColumns = db.prepare('PRAGMA table_info(countries)').all();
const hasLogoUrl = countriesColumns.some(c => c.name === 'logo_url');
console.log(`countries.logo_url: ${hasLogoUrl ? 'PRESENT' : 'MISSING'}`);

db.close();
console.log(`\n=== END DIAGNOSTICS ===\n`);
