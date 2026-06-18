import sqlite3
db='/tmp/gito.sqlite'
con=sqlite3.connect(db)
cur=con.cursor()
print('PRAGMA table_info(sports):')
for row in cur.execute("PRAGMA table_info(sports);"):
    print(row)
print('\nLast sports row:')
for row in cur.execute("SELECT * FROM sports ORDER BY created_at DESC LIMIT 1;"):
    print('columns:', [d[0] for d in cur.description])
    print(row)
con.close()
