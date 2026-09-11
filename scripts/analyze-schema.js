#!/usr/bin/env node
/**
 * Schema Analysis Script
 * 
 * Dynamically inspects the production database schema without modification:
 * - Enumerates all tables, indexes, triggers, views
 * - Analyzes FK dependencies
 * - Identifies IPTV-related tables
 * - Checks if retained tables reference excluded tables
 * - Reports findings for backup classification
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.resolve(projectRoot, 'data', 'gito.sqlite');

console.log('📊 Schema Analysis\n');
console.log(`Database: ${dbPath}\n`);

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

try {
  // 1. List all tables
  console.log('═══ TABLES ═══\n');
  const tables = db.prepare(`
    SELECT name, sql FROM sqlite_master 
    WHERE type='table' 
    ORDER BY name
  `).all();
  
  console.log(`Total tables: ${tables.length}\n`);
  tables.forEach(t => {
    console.log(`  • ${t.name}`);
  });
  
  // 2. Identify IPTV-related tables
  console.log('\n═══ IPTV-RELATED TABLES ═══\n');
  const iptvTables = tables.filter(t => 
    t.name.startsWith('iptv_') || t.name === 'channels'
  );
  console.log(`IPTV tables: ${iptvTables.length}\n`);
  iptvTables.forEach(t => {
    console.log(`  • ${t.name}`);
  });
  
  // 3. Count rows in IPTV tables
  console.log('\n═══ IPTV TABLE ROW COUNTS ═══\n');
  iptvTables.forEach(t => {
    try {
      const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${t.name}`).get();
      console.log(`  ${t.name}: ${count.cnt} rows`);
    } catch (e) {
      console.log(`  ${t.name}: [error reading]`);
    }
  });
  
  // 4. List all indexes
  console.log('\n═══ INDEXES ═══\n');
  const indexes = db.prepare(`
    SELECT name, tbl_name, sql FROM sqlite_master 
    WHERE type='index' AND sql IS NOT NULL
    ORDER BY tbl_name, name
  `).all();
  
  console.log(`Total indexes: ${indexes.length}\n`);
  indexes.forEach(idx => {
    console.log(`  • ${idx.name} (on ${idx.tbl_name})`);
  });
  
  // 5. List all triggers
  console.log('\n═══ TRIGGERS ═══\n');
  const triggers = db.prepare(`
    SELECT name, tbl_name, sql FROM sqlite_master 
    WHERE type='trigger'
    ORDER BY tbl_name, name
  `).all();
  
  console.log(`Total triggers: ${triggers.length}\n`);
  if (triggers.length > 0) {
    triggers.forEach(t => {
      console.log(`  • ${t.name} (on ${t.tbl_name})`);
    });
  } else {
    console.log('  [none]');
  }
  
  // 6. List all views
  console.log('\n═══ VIEWS ═══\n');
  const views = db.prepare(`
    SELECT name, sql FROM sqlite_master 
    WHERE type='view'
    ORDER BY name
  `).all();
  
  console.log(`Total views: ${views.length}\n`);
  if (views.length > 0) {
    views.forEach(v => {
      console.log(`  • ${v.name}`);
    });
  } else {
    console.log('  [none]');
  }
  
  // 7. Analyze foreign keys
  console.log('\n═══ FOREIGN KEY ANALYSIS ═══\n');
  const fkAnalysis = {};
  tables.forEach(t => {
    try {
      const fks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all();
      if (fks.length > 0) {
        fkAnalysis[t.name] = fks;
      }
    } catch (e) {
      // Skip if table doesn't exist or error
    }
  });
  
  console.log(`Tables with FKs: ${Object.keys(fkAnalysis).length}\n`);
  Object.entries(fkAnalysis).forEach(([table, fks]) => {
    console.log(`  ${table}:`);
    fks.forEach(fk => {
      console.log(`    → ${fk.table}(${fk.from}) references ${fk.table}(${fk.to})`);
    });
  });
  
  // 8. Check if retained tables reference excluded IPTV tables
  console.log('\n═══ FK DEPENDENCY RISK ANALYSIS ═══\n');
  const coreRetainedTables = [
    'providers', 'sports', 'teams', 'competitions', 'seasons',
    'matches', 'streams', 'operator_users', 'auth_sessions'
  ];
  
  const iptvTableNames = iptvTables.map(t => t.name);
  
  let foundRisk = false;
  Object.entries(fkAnalysis).forEach(([table, fks]) => {
    fks.forEach(fk => {
      if (coreRetainedTables.includes(table) && iptvTableNames.includes(fk.table)) {
        console.log(`⚠️  RISK: ${table} references IPTV table ${fk.table}`);
        foundRisk = true;
      }
    });
  });
  
  if (!foundRisk) {
    console.log('✓ No core retained tables reference IPTV catalogue tables');
  }
  
  // 9. Providers table structure
  console.log('\n═══ PROVIDERS TABLE STRUCTURE ═══\n');
  try {
    const providerInfo = db.prepare(`PRAGMA table_info(providers)`).all();
    providerInfo.forEach(col => {
      console.log(`  ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
    });
    
    const providerCount = db.prepare(`SELECT COUNT(*) as cnt FROM providers`).get();
    console.log(`\n  Total providers: ${providerCount.cnt}`);
  } catch (e) {
    console.log(`  [error reading providers]`);
  }
  
  // 10. Verify schema_version and user_version
  console.log('\n═══ DATABASE PRAGMAS ═══\n');
  const schemaVersion = db.prepare(`PRAGMA schema_version`).get();
  const userVersion = db.prepare(`PRAGMA user_version`).get();
  console.log(`  schema_version: ${schemaVersion['schema_version']}`);
  console.log(`  user_version: ${userVersion['user_version']}`);
  
  // 11. Summary
  console.log('\n═══ SUMMARY ═══\n');
  console.log(`  Total tables: ${tables.length}`);
  console.log(`  IPTV-related: ${iptvTables.length}`);
  console.log(`  Core retained: ${coreRetainedTables.length}`);
  console.log(`  Total indexes: ${indexes.length}`);
  console.log(`  Total triggers: ${triggers.length}`);
  console.log(`  Total views: ${views.length}`);
  
} finally {
  db.close();
}
