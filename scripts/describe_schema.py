import sqlite3, os, json
path = os.path.join(r'c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports', 'apps', 'backend', 'data', 'gito.sqlite')
print('DB path:', path)
conn = sqlite3.connect(path)
cur = conn.cursor()
for table in ['streams','matches']:
    print('\nSCHEMA for', table)
    cur.execute(f"PRAGMA table_info({table})")
    cols = cur.fetchall()
    print(json.dumps(cols, indent=2))

print('\nStream rows with status=failed or healthStatus=failed')
cur.execute("SELECT rowid, * FROM streams WHERE status='failed' OR healthStatus='failed'")
rows = cur.fetchall()
print('count:', len(rows))
for r in rows:
    print(r)

print('\nMost recent 50 stream rows by updatedAt:')
try:
    cur.execute("SELECT rowid, * FROM streams ORDER BY datetime(updatedAt) DESC LIMIT 50")
    for r in cur.fetchall():
        print(r)
except Exception as e:
    print('Error ordering by updatedAt:', e)

conn.close()