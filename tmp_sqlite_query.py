import os, sqlite3, json
path = os.path.join("data", "gito.sqlite")
conn = sqlite3.connect(path)
cur = conn.cursor()
cur.execute("PRAGMA table_info(sports)")
rows = cur.fetchall()
print(json.dumps(rows, indent=2))
