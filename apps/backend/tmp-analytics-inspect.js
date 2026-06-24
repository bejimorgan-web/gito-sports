import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(backendDir, '..', '..');
const dbPath = path.resolve(workspaceRoot, 'data', 'gito.sqlite');
console.log('DB PATH:', dbPath);
const db = new Database(dbPath, { readonly: true });
console.log('EVENT COUNT:', db.prepare('SELECT count(*) AS c FROM mobile_analytics_events').get());
console.log('AD EVENT COUNT:', db.prepare('SELECT count(*) AS c FROM mobile_ad_events').get());
console.log('EVENT ROWS:', JSON.stringify(db.prepare('SELECT id,event_type,session_id,match_id,payload,user_agent,ip_address,created_at FROM mobile_analytics_events ORDER BY created_at DESC LIMIT 10').all(), null, 2));
console.log('AD EVENT ROWS:', JSON.stringify(db.prepare('SELECT id,promotion_id,event_type,session_id,match_id,metadata,created_at FROM mobile_ad_events ORDER BY created_at DESC LIMIT 10').all(), null, 2));
