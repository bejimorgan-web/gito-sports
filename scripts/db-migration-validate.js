#!/usr/bin/env node

/**
 * Database Validation Script
 * Compares local SQLite data counts with production backend
 * 
 * Usage: node scripts/db-migration-validate.js
 * 
 * Environment variables:
 *   VITE_API_URL: Production API endpoint (default: https://gito-sports.onrender.com)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const LOCAL_DB_PATH = path.join(PROJECT_ROOT, 'data', 'gito.sqlite');
const API_URL = process.env.VITE_API_URL || 'https://gito-sports.onrender.com';

const TABLES = [
  'sports',
  'providers',
  'channels',
  'competitions',
  'seasons',
  'teams',
  'matches',
  'streams',
  'operator_users',
];

async function getLocalCounts() {
  const counts = {};

  try {
    const db = new Database(LOCAL_DB_PATH, { readonly: true });
    db.pragma('query_only = ON');

    for (const tableName of TABLES) {
      try {
        const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get();
        counts[tableName] = cnt;
      } catch (err) {
        counts[tableName] = 0;
      }
    }

    db.close();
  } catch (err) {
    console.error(`❌ Failed to read local database: ${err.message}`);
    process.exit(1);
  }

  return counts;
}

async function getProductionCounts() {
  const counts = {};

  try {
    const response = await fetch(`${API_URL}/api/health`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  } catch (err) {
    console.error(`❌ Cannot reach production API: ${err.message}`);
    console.error(`   URL: ${API_URL}`);
    process.exit(1);
  }

  for (const tableName of TABLES) {
    try {
      const response = await fetch(`${API_URL}/api/data/counts/${tableName}`);
      if (response.ok) {
        const data = await response.json();
        counts[tableName] = data.count || 0;
      } else {
        counts[tableName] = null;
      }
    } catch (err) {
      counts[tableName] = null;
    }
  }

  return counts;
}

async function validateMigration() {
  console.log('🔍 Validation Report: Local vs Production\n');

  // Get local counts
  console.log('📂 Reading local database...');
  const localCounts = await getLocalCounts();

  // Get production counts
  console.log('🌐 Querying production API...');
  const productionCounts = await getProductionCounts();

  // Display comparison
  console.log('\n📊 Comparison:\n');
  console.log('Table'.padEnd(30) + 'Local'.padEnd(12) + 'Production'.padEnd(12) + 'Status');
  console.log('-'.repeat(70));

  let allGood = true;
  for (const table of TABLES) {
    const local = localCounts[table] || 0;
    const prod = productionCounts[table];

    let status;
    if (prod === null) {
      status = '❓ [unable to verify]';
      allGood = false;
    } else if (prod >= local && local > 0) {
      status = '✓ OK';
    } else if (local === 0 && prod >= 0) {
      status = '○ empty';
    } else {
      status = '❌ MISMATCH';
      allGood = false;
    }

    const prodDisplay = prod === null ? 'N/A' : String(prod);
    console.log(
      table.padEnd(30) +
      String(local).padEnd(12) +
      prodDisplay.padEnd(12) +
      status
    );
  }

  // Critical checks
  console.log('\n📈 Critical Checks:\n');
  const checks = [
    { table: 'sports', label: 'Sports defined', required: true },
    { table: 'providers', label: 'Providers configured', required: true },
    { table: 'channels', label: 'Channels available', required: true },
    { table: 'matches', label: 'Matches scheduled', required: false },
  ];

  for (const check of checks) {
    const local = localCounts[check.table] || 0;
    const prod = productionCounts[check.table];

    const required = check.required ? ' [REQUIRED]' : '';
    if (local > 0) {
      if (prod !== null && prod > 0) {
        console.log(`✓ ${check.label}${required}: ${local} local → ${prod} production`);
      } else if (prod === null) {
        console.log(`⚠️  ${check.label}${required}: ${local} local → unable to verify`);
      } else {
        console.log(`❌ ${check.label}${required}: ${local} local → ${prod} production`);
        allGood = false;
      }
    } else {
      console.log(`○ ${check.label}: empty`);
    }
  }

  // Summary
  console.log('\n' + (allGood ? '✅ Validation passed!' : '⚠️  Validation completed with issues.'));

  return allGood ? 0 : 1;
}

validateMigration()
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error('❌ Validation failed:', err.message);
    process.exit(1);
  });
