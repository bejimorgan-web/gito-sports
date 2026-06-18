import sqlite3, os
path = os.path.join(r'c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports', 'apps', 'backend', 'data', 'gito.sqlite')
conn = sqlite3.connect(path)
cur = conn.cursor()
stream_id = '28ddc271-9ece-4b2e-ac0d-35bdef373cde'
print('Operational logs for stream', stream_id)
for row in cur.execute("SELECT id, event_type, entity_type, entity_id, severity, message, metadata, created_at FROM operational_logs WHERE entity_id = ? ORDER BY created_at DESC", (stream_id,)):
    print(row)

print('\nRecent stream-related events:')
for row in cur.execute("SELECT id, event_type, entity_type, entity_id, severity, message, metadata, created_at FROM operational_logs WHERE entity_type = 'stream' ORDER BY created_at DESC LIMIT 200"):
    print(row)

conn.close()