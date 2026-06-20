/**
 * Database Migration Endpoints
 * 
 * Add these routes to your backend app initialization:
 * 
 * import { migrationRouter } from './routes/migration.routes.ts';
 * app.use('/api/admin/migration', migrationRouter);
 */

import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyAccessToken } from '../services/jwt.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware: Validate admin authentication (JWT OR migration token)
function validateAdminAuth(req: Request, res: Response, next: Function) {
  console.log('MIGRATION AUTH HEADER:', req.headers.authorization);
  console.log('MIGRATION USER BEFORE AUTH:', (req as any).user);

  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');

  // Try JWT first
  const payload = verifyAccessToken(token);
  if (payload) {
    // Valid JWT - check if user is admin
    if (payload.role === 'admin' || payload.role === 'operator') {
      (req as any).user = { id: payload.sub, role: payload.role };
      return next();
    }
  }

  // Fall back to migration token if JWT failed
  const expectedToken = process.env.MIGRATION_IMPORT_TOKEN;
  if (token === expectedToken && expectedToken) {
    (req as any).user = { id: 'migration-token', role: 'admin' };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

router.use(validateAdminAuth);

/**
 * POST /api/admin/migration/import/:tableName
 * Import data into a specific table
 */
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

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

router.post('/import/all', (req: Request, res: Response) => {
  // Log raw request details before processing
  const reqAny = req as any;
  const contentLength = req.headers['content-length'];
  const rawBodyLength = reqAny.rawBodyLength;
  const rawBodyHash = reqAny.rawBodyHash;
  
  console.log(`[migration/import/all] RECEIVED:`);
  console.log(`  content-length: ${contentLength}`);
  console.log(`  raw-body-length: ${rawBodyLength}`);
  console.log(`  raw-body-hash: ${rawBodyHash}`);
  
  if (reqAny.rawBody) {
    const preview = reqAny.rawBody.slice(0, 200);
    const suffix = reqAny.rawBody.slice(-200);
    console.log(`  first-200-chars: ${preview}`);
    console.log(`  last-200-chars: ${suffix}`);
  }
  
  let raw: Record<string, any>;
  
  // Safely parse JSON body with diagnostics
  try {
    if (typeof req.body === 'string') {
      raw = JSON.parse(req.body);
    } else {
      raw = req.body as Record<string, any>;
    }
  } catch (parseErr) {
    const err = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
    console.error(`[migration/import/all] JSON PARSE ERROR: ${err.message}`);
    console.error(`  raw-body-length: ${rawBodyLength}`);
    console.error(`  content-length: ${contentLength}`);
    
    return res.status(400).json({
      error: 'invalid_json_received',
      message: err.message,
      position: (err as any).position || null,
      length: rawBodyLength,
      contentLength: contentLength,
      hash: rawBodyHash,
      preview: reqAny.rawBody?.slice(0, 500) || 'N/A',
    });
  }
  
  console.log('RAW_KEYS', Object.keys(raw));

  const isExportFormat = raw.tables && typeof raw.tables === 'object';
  const tables = isExportFormat ? raw.tables : raw;
  const order = Array.isArray(raw.order) ? raw.order : Object.keys(tables);

  console.log('TABLE_KEYS', Object.keys(tables));
  console.log('ORDER', order);

  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    return res.status(400).json({
      error: 'Invalid migration payload',
      receivedKeys: Object.keys(req.body),
    });
  }

  if (!Array.isArray(order)) {
    return res.status(400).json({
      error: 'Invalid migration payload',
      receivedKeys: Object.keys(req.body),
    });
  }

  const validTables = new Set(IMPORT_ORDER);
  const errors: string[] = [];
  let imported = 0;
  let totalRows = 0;

  try {
    const dbPath = process.env.DATABASE_PATH || '/tmp/gito.sqlite';
    const db = new Database(dbPath);
    (db as any).pragma('foreign_keys = ON');
    db.exec('BEGIN');

    try {
      for (const tableName of order) {
        if (!validTables.has(tableName)) {
          errors.push(`Skipped invalid table: ${tableName}`);
          continue;
        }

        const rows = tables[tableName] || [];
        if (!Array.isArray(rows) || rows.length === 0) {
          continue;
        }

        totalRows += rows.length;
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            errors.push(`Invalid row data for table ${tableName}`);
            continue;
          }

          try {
            const columns = Object.keys(row);
            if (columns.length === 0) {
              continue;
            }

            const placeholders = columns.map(() => '?').join(',');
            const quotedColumns = columns.map(quoteIdent).join(',');
            const values = columns.map(col => row[col]);
            const quotedTable = quoteIdent(tableName);

            const stmt = db.prepare(`INSERT OR REPLACE INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`);
            stmt.run(...values);
            imported++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`Table ${tableName}: ${message}`);
          }
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    db.close();

    res.json({
      success: true,
      imported,
      totalRows,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: 'Import failed',
      message,
    });
  }
});

router.post('/import/:tableName', (req: Request, res: Response) => {
  const tableName = req.params.tableName ?? "";
  const { rows } = req.body;

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows must be an array' });
  }

  // Validate table name (prevent SQL injection)
  const validTables = [
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

  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    const dbPath = process.env.DATABASE_PATH || '/tmp/gito.sqlite';
    const db = new Database(dbPath);
    (db as any).pragma('foreign_keys = ON');

    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(',');
        const quotedColumns = columns.map(quoteIdent).join(',');
        const values = columns.map(col => row[col]);
        const quotedTable = quoteIdent(tableName);

        const stmt = db.prepare(
          `INSERT OR REPLACE INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`
        );

        stmt.run(...values);
        imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${imported}: ${message}`);
      }
    }

    db.close();

    res.json({
      imported,
      errors: errors.slice(0, 10), // Return first 10 errors
      total: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: 'Import failed',
      message,
    });
  }
});

/**
 * GET /api/admin/migration/count/:tableName
 * Get row count for a table
 */
router.get('/count/:tableName', (req: Request, res: Response) => {
  const tableName = req.params.tableName ?? "";

  // Validate table name
  const validTables = [
    'sports', 'regions', 'countries', 'sport_countries', 'providers',
    'channels', 'competitions', 'seasons', 'teams', 'competition_teams',
    'matches', 'scheduling_matches', 'match_streams', 'streams',
    'operator_users', 'operator_settings', 'auth_sessions',
    'entity_catalog_mapping', 'sport_host_links', 'sport_competition_links',
    'sport_club_links', 'sport_national_team_links', 'competition_club_links',
    'competition_national_team_links', 'host_competition_links',
  ];

  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    const dbPath = process.env.DATABASE_PATH || '/tmp/gito.sqlite';
    const db = new Database(dbPath);

    const quotedTable = quoteIdent(tableName);
    const { count: total } = db
      .prepare(`SELECT COUNT(*) as count FROM ${quotedTable}`)
      .get() as { count: number };

    db.close();

    res.json({ table: tableName, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: 'Count failed',
      message,
    });
  }
});

/**
 * GET /api/admin/migration/status
 * Get overall migration status
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const dbPath = process.env.DATABASE_PATH || '/tmp/gito.sqlite';
    const db = new Database(dbPath);

    const tables = [
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

    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
          count: number;
        };
        counts[table] = count;
      } catch {
        counts[table] = 0;
      }
    }

    db.close();

    const critical = {
      sports: (counts.sports ?? 0) > 0,
      providers: (counts.providers ?? 0) > 0,
      channels: (counts.channels ?? 0) > 0,
      matches: (counts.matches ?? 0) > 0,
    };

    res.json({
      ready: Object.values(critical).every(v => v),
      counts,
      critical,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: 'Status check failed',
      message,
    });
  }
});

export { router as migrationRouter };
