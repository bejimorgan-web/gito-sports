#!/usr/bin/env node

/**
 * Local Database Export Script
 * Exports all data from local SQLite to JSON for migration to production
 * 
 * Usage: node scripts/db-migration-export.js [--output path/to/export.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const LOCAL_DB_PATH = path.join(PROJECT_ROOT, 'data', 'gito.sqlite');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'migration-export.json');

// Parse command-line arguments
const args = process.argv.slice(2);
let outputPath = DEFAULT_OUTPUT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[i + 1];
  }
}

// Core tables to export (in dependency order)
const TABLES = [
  'sports',
  'regions',
  'countries',
  'sport_countries',
  'providers',
  'channels',
  'competitions',
  'seasons',
  'teams',
  'competition_teams',
  'matches',
  'scheduling_matches',
  'match_streams',
  'streams',
  'operator_users',
  'operator_settings',
  'auth_sessions',
  'entity_catalog_mapping',
  'sport_host_links',
  'sport_competition_links',
  'sport_club_links',
  'sport_national_team_links',
  'competition_club_links',
  'competition_national_team_links',
  'host_competition_links',
];

async function exportDatabase() {
  console.log('🔍 Starting database export...\n');

  // Check if local DB exists
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    console.error(`❌ Local database not found: ${LOCAL_DB_PATH}`);
    process.exit(1);
  }

  console.log(`📂 Local DB: ${LOCAL_DB_PATH}`);
  const stats = fs.statSync(LOCAL_DB_PATH);
  console.log(`📦 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  let db;
  try {
    // Open database in read-only mode
    db = new Database(LOCAL_DB_PATH, { readonly: true });
    
    // Enable WAL mode compatibility
    db.pragma('query_only = ON');

    const exportData = {
      exportedAt: new Date().toISOString(),
      source: LOCAL_DB_PATH,
      order: TABLES,
      tables: {},
      summary: {},
    };

    console.log('\n📊 Table Counts:\n');

    // Export each table
    for (const tableName of TABLES) {
      try {
        const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`);
        const { cnt } = countStmt.get();

        if (cnt > 0) {
          const stmt = db.prepare(`SELECT * FROM ${tableName}`);
          const rows = stmt.all();
          exportData.tables[tableName] = rows;
          exportData.summary[tableName] = {
            count: cnt,
            sample: rows.length > 0 ? rows[0] : null,
          };
          console.log(`✓ ${tableName.padEnd(30)} ${cnt} rows`);
        } else {
          exportData.tables[tableName] = [];
          exportData.summary[tableName] = { count: 0 };
          console.log(`○ ${tableName.padEnd(30)} 0 rows`);
        }
      } catch (err) {
        // Table might not exist
        console.log(`⊘ ${tableName.padEnd(30)} [table not found]`);
      }
    }

    // Print critical counts
    console.log('\n📈 Critical Counts:');
    console.log(
      `  SPORTS:     ${exportData.summary.sports?.count || 0}`,
      exportData.summary.sports?.count > 0 ? '✓' : '⚠️'
    );
    console.log(
      `  PROVIDERS:  ${exportData.summary.providers?.count || 0}`,
      exportData.summary.providers?.count > 0 ? '✓' : '⚠️'
    );
    console.log(
      `  CHANNELS:   ${exportData.summary.channels?.count || 0}`,
      exportData.summary.channels?.count > 0 ? '✓' : '⚠️'
    );
    console.log(
      `  MATCHES:    ${exportData.summary.matches?.count || 0}`,
      exportData.summary.matches?.count > 0 ? '✓' : '⚠️'
    );
    console.log(
      `  STREAMS:    ${exportData.summary.streams?.count || 0}`,
      exportData.summary.streams?.count > 0 ? '✓' : '⚠️'
    );

    // Write export file
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`\n✅ Export complete: ${outputPath}`);
    console.log(`📋 File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);

  } finally {
    if (db) db.close();
  }
}

exportDatabase().catch(err => {
  console.error('❌ Export failed:', err.message);
  process.exit(1);
});
