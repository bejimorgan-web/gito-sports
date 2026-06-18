import os, sqlite3, json
path = os.path.join('apps', 'backend', 'data', 'gito.sqlite')
conn = sqlite3.connect(path)
cur = conn.cursor()
cur.execute('SELECT rowid,id,name,slug,status,created_at,updated_at,logo_url FROM sports WHERE id=?', ('40658823-67c2-4564-8974-3ac180f8bb4e',))
row = cur.fetchone()
print(json.dumps(row, indent=2))
cur.execute('SELECT country_id FROM sport_countries WHERE sport_id=? ORDER BY country_id', ('40658823-67c2-4564-8974-3ac180f8bb4e',))
countries = [r[0] for r in cur.fetchall()]
print(json.dumps(countries, indent=2))
