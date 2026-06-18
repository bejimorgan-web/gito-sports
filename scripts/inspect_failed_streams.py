import sqlite3, os, sys
path = os.path.join(r'c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports', 'apps', 'backend', 'data', 'gito.sqlite')
if not os.path.exists(path):
    print('DB not found:', path)
    sys.exit(1)
conn = sqlite3.connect(path)
cur = conn.cursor()
print('Checking streams with health_status="failed" or status="failed"')
cur.execute("SELECT id, matchId, status, healthStatus, failureCount, createdAt, updatedAt FROM streams WHERE healthStatus='failed' OR status='failed'")
rows = cur.fetchall()
if not rows:
    print('No failed streams found')
else:
    for r in rows:
        print('STREAM', r)

print('\nRecent streams (last 50 updates ordered by updatedAt desc):')
cur.execute("SELECT id, matchId, status, healthStatus, failureCount, createdAt, updatedAt FROM streams ORDER BY datetime(updatedAt) DESC LIMIT 50")
for r in cur.fetchall():
    print('RECENT', r)

conn.close()