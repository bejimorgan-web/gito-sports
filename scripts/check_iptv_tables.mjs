import Database from './apps/backend/node_modules/better-sqlite3';
const db = new Database('data/gito.sqlite', { readonly: true });
const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'iptv_%'").all();
console.log(rows.map(r => r.name));
db.close();
