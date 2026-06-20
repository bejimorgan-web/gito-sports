#!/usr/bin/env node

/**
 * Production Database Import Script
 * Imports migration export JSON into Render production backend via REST API
 * 
 * Usage: node scripts/db-migration-import.js [--input path/to/export.json] [--api-url https://...]
 * 
 * Environment variables:
 *   VITE_API_URL: Production API endpoint (default: https://gito-sports.onrender.com)
 *   MIGRATION_IMPORT_TOKEN: Admin token for import endpoint (required)
 * 
 * This script now posts the full export payload to /api/admin/migration/import/all.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const DEFAULT_EXPORT = path.join(PROJECT_ROOT, 'migration-export.json');
const API_URL = process.env.VITE_API_URL || 'https://gito-sports.onrender.com';
const IMPORT_TOKEN = process.env.MIGRATION_IMPORT_TOKEN;

// Parse command-line arguments
const args = process.argv.slice(2);
let inputPath = DEFAULT_EXPORT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && args[i + 1]) {
    inputPath = args[i + 1];
  }
}

// Dependency order for import (respecting foreign keys)
const IMPORT_ORDER = [
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

async function validateEnvironment() {
  if (!IMPORT_TOKEN) {
    console.error('❌ Missing MIGRATION_IMPORT_TOKEN environment variable');
    console.error('   Set it before running: export MIGRATION_IMPORT_TOKEN="your-token"');
    process.exit(1);
  }
}

async function fetchWithAuth(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${IMPORT_TOKEN}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  return response.json();
}

async function importDatabase() {
  console.log('🔍 Starting database import...\n');

  // Validate environment
  await validateEnvironment();

  // Check if export file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Export file not found: ${inputPath}`);
    process.exit(1);
  }

  // Load export data
  console.log(`📂 Loading export: ${inputPath}`);
  const exportData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  console.log(`📅 Export date: ${exportData.exportedAt}`);

  // Verify local counts before import
  console.log('\n📊 Pre-Import Local Counts:');
  for (const table of IMPORT_ORDER) {
    const count = exportData.summary[table]?.count || 0;
    console.log(`  ${table.padEnd(30)} ${count} rows`);
  }

  // Check API connectivity
  console.log(`\n🌐 Connecting to: ${API_URL}`);
  try {
    const health = await fetchWithAuth('/api/health');
    console.log('✓ API is reachable');
  } catch (err) {
    console.error(`❌ Failed to reach API: ${err.message}`);
    process.exit(1);
  }

  // Import the full export payload in one request
  console.log('\n📥 Importing full export payload...\n');

  let importResponse;
  try {
    importResponse = await fetchWithAuth('/api/admin/migration/import/all', {
      method: 'POST',
      body: JSON.stringify(exportData),
    });

    console.log(`✓ Imported ${importResponse.imported || 0} rows across tables`);
    if (importResponse.errors && importResponse.errors.length > 0) {
      console.log(`  ⚠️  Errors: ${importResponse.errors.length}`);
      importResponse.errors.slice(0, 5).forEach((err, index) => {
        console.log(`     ${index + 1}. ${err}`);
      });
    }
  } catch (err) {
    console.error(`❌ Import failed: ${err.message}`);
    process.exit(1);
  }

  // Verify import
  console.log('\n📊 Post-Import Verification:\n');
  let verificationFailed = false;

  const criticalTables = {
    sports: 'SPORTS',
    providers: 'PROVIDERS',
    channels: 'CHANNELS',
    matches: 'MATCHES',
  };

  for (const [table, label] of Object.entries(criticalTables)) {
    try {
      const count = await fetchWithAuth(`/api/admin/migration/count/${table}`);
      const expected = exportData.summary[table]?.count || 0;
      const match = count.total >= expected ? '✓' : '⚠️';
      console.log(`${match} ${label.padEnd(15)} Local: ${expected}, Production: ${count.total}`);
      if (count.total < expected && expected > 0) {
        verificationFailed = true;
      }
    } catch (err) {
      console.log(`❌ ${label.padEnd(15)} Failed to verify: ${err.message}`);
      verificationFailed = true;
    }
  }

  // Summary
  console.log('\n📈 Import Summary:');
  const totalImported = importResponse?.imported || 0;
  const totalErrors = importResponse?.errors?.length || 0;

  console.log(`  Total records imported: ${totalImported}`);
  console.log(`  Total errors: ${totalErrors}`);

  if (verificationFailed) {
    console.log('\n⚠️  Verification warnings detected. Review counts above.');
  } else {
    console.log('\n✅ Import complete and verified!');
  }

  // Write import report
  const reportPath = path.join(PROJECT_ROOT, 'migration-import-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    importedAt: new Date().toISOString(),
    apiUrl: API_URL,
    response: importResponse,
    summary: {
      totalImported,
      totalErrors,
    },
  }, null, 2));

  console.log(`\n📋 Report saved: ${reportPath}`);
}

importDatabase().catch(err => {
  console.error('❌ Import failed:', err.message);
  process.exit(1);
});
