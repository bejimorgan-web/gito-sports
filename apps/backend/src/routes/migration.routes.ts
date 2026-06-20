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

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware: Validate admin token
function validateAdminToken(req: Request, res: Response, next: Function) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.MIGRATION_IMPORT_TOKEN;

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

router.use(validateAdminToken);

/**
 * POST /api/admin/migration/import/:tableName
 * Import data into a specific table
 */
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

    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        // Build INSERT statement
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(',');
        const values = columns.map(col => row[col]);

        const stmt = db.prepare(
          `INSERT OR REPLACE INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`
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
    'sports', 'providers', 'channels', 'competitions', 'seasons',
    'teams', 'matches', 'streams', 'operator_users', 'countries',
  ];

  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    const dbPath = process.env.DATABASE_PATH || '/tmp/gito.sqlite';
    const db = new Database(dbPath);

    const { count: total } = db
      .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
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
