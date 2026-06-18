import sqlite3, os, json
path = os.path.join(r'c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports', 'apps', 'backend', 'data', 'gito.sqlite')
print('DB:', path)
conn = sqlite3.connect(path)
cur = conn.cursor()
# find rows where status or health_status is failed
cur.execute("SELECT id, match_id, channel_id, protocol, status, health_status, health_reason, failure_count, created_at, updated_at, last_health_at FROM streams WHERE status='failed' OR health_status='failed'")
rows = cur.fetchall()
print('failed_count:', len(rows))
for r in rows:
    print('FAILED_STREAM:', r)

print('\nRecent 50 stream updates:')
cur.execute("SELECT id, match_id, status, health_status, failure_count, health_reason, updated_at, last_health_at FROM streams ORDER BY datetime(updated_at) DESC LIMIT 50")
for r in cur.fetchall():
    print('RECENT:', r)

conn.close()