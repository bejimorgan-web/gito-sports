#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const DEFAULT_EXPORT_FILE = path.join(PROJECT_ROOT, 'migration-export.json');
const DEFAULT_URL = 'http://localhost:4100/api/admin/migration/import/all';

function usage() {
  console.log(`Usage: node scripts/test-migration-gzip.mjs [options]

Options:
  --file <path>        Path to migration export JSON file (default: migration-export.json)
  --url <url>          Target import endpoint (default: ${DEFAULT_URL})
  --token <token>      Migration import bearer token (or use MIGRATION_IMPORT_TOKEN env)
  --plain              Send plain JSON instead of gzip-compressed payload
  --help               Show this help message
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: DEFAULT_EXPORT_FILE,
    url: DEFAULT_URL,
    token: process.env.MIGRATION_IMPORT_TOKEN || '',
    plain: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--file':
        options.file = args[++i];
        break;
      case '--url':
        options.url = args[++i];
        break;
      case '--token':
        options.token = args[++i];
        break;
      case '--plain':
        options.plain = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }

  return options;
}

async function main() {
  const { file, url, token, plain } = parseArgs();

  if (!token) {
    console.error('Missing migration token. Set MIGRATION_IMPORT_TOKEN or use --token.');
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const payloadText = fs.readFileSync(file, 'utf8');
  const payloadBuffer = Buffer.from(payloadText, 'utf8');
  const body = plain ? payloadBuffer : gzipSync(payloadBuffer);

  console.log(`Sending ${plain ? 'plain JSON' : 'gzip-compressed JSON'} payload:`);
  console.log(`  file: ${file}`);
  console.log(`  url: ${url}`);
  console.log(`  payload bytes: ${payloadBuffer.length}`);
  console.log(`  body bytes: ${body.length}`);
  console.log(`  content-encoding: ${plain ? 'none' : 'gzip'}`);

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (!plain) {
    headers['Content-Encoding'] = 'gzip';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  console.log(`\nResponse status: ${response.status} ${response.statusText}`);
  const responseText = await response.text();
  try {
    const json = JSON.parse(responseText);
    console.log('Response body (JSON):');
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log('Response body (text):');
    console.log(responseText);
  }

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
