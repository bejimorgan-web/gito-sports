const crypto = require('crypto');
const Database = require('./apps/backend/node_modules/better-sqlite3');

const keySecret = 'test-ipv-key-please-change';
const key = crypto.createHash('sha256').update(keySecret).digest();

function encryptCredentials(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

const db = new Database('data/gito.sqlite');
const id = crypto.randomUUID();
const now = new Date().toISOString();
const enc = encryptCredentials({ username: 'u-secret', password: 'p-secret' });

const stmt = db.prepare(`INSERT INTO iptv_providers (id, name, type, server_url, encrypted_credentials, expires_at, enabled, health_status, last_refresh_at, total_channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
stmt.run(id, 'insert-test', 'xtream', 'http://example.com', enc, null, 1, 'unknown', null, 0, now, now);

const row = db.prepare('SELECT id, encrypted_credentials FROM iptv_providers WHERE id = ?').get(id);
console.log('inserted id=', row.id);
console.log('encrypted_credentials sample=', row.encrypted_credentials && row.encrypted_credentials.slice(0,60));

function decrypt(blob) {
  const parts = blob.split(':');
  if (parts.length !== 3) return null;
  const [ivPart, tagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart, 'base64');
  const tag = Buffer.from(tagPart, 'base64');
  const data = Buffer.from(dataPart, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

const decrypted = decrypt(row.encrypted_credentials);
console.log('decrypted=', decrypted);

db.close();
