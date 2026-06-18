#!/usr/bin/env python3
import sqlite3
import json
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

db_path = '/tmp/gito.sqlite'
provider_id = '9fe16532-ac82-4650-9ae7-2dfab9f575f9'
test_url = f'http://localhost:4100/iptv/providers/{provider_id}/test'

def get_db_state(label):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    # provider row
    prov = cur.execute('SELECT id, name, status, created_at, updated_at FROM providers WHERE id = ?', (provider_id,)).fetchone()
    prov_dict = dict(prov) if prov else None
    # channel count
    ch_count = cur.execute('SELECT COUNT(*) AS cnt FROM channels WHERE provider_id = ? AND status = ?', (provider_id, 'active')).fetchone()['cnt']
    con.close()
    return {'label': label, 'provider_row': prov_dict, 'active_channels': ch_count}

# Get state before test
before = get_db_state('before_test')
print('=== DB STATE BEFORE TEST ===')
print(json.dumps(before, indent=2, default=str))

# Make HTTP request
print('\n=== HTTP REQUEST ===')
print(f'POST {test_url}')
http_status = None
http_body = None
http_error = None

try:
    req = Request(test_url, method='POST')
    with urlopen(req) as response:
        http_status = response.status
        http_body = response.read().decode('utf-8')
except HTTPError as e:
    http_status = e.code
    http_body = e.read().decode('utf-8')
    http_error = str(e)
except URLError as e:
    http_error = f'URLError: {e}'
except Exception as e:
    http_error = f'{type(e).__name__}: {e}'

print(f'Status: {http_status}')
if http_error:
    print(f'Error: {http_error}')
if http_body:
    print('Response body:')
    print(http_body)

# Parse response if JSON
response_data = None
if http_body:
    try:
        response_data = json.loads(http_body)
        print('\nParsed JSON:')
        print(json.dumps(response_data, indent=2))
    except:
        pass

# Get state after test
after = get_db_state('after_test')
print('\n=== DB STATE AFTER TEST ===')
print(json.dumps(after, indent=2, default=str))

# Summary
print('\n=== SUMMARY ===')
print(f'Provider exists before: {before["provider_row"] is not None}')
print(f'Provider exists after: {after["provider_row"] is not None}')
print(f'HTTP status: {http_status}')
print(f'Active channels before: {before["active_channels"]}')
print(f'Active channels after: {after["active_channels"]}')
print(f'Provider marked deleted: N/A (no deleted column in this DB)')
print(f'Test endpoint executed despite missing provider: {http_status is not None}')
