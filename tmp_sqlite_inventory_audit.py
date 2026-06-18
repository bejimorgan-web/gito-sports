import json
import sqlite3
from datetime import datetime
from pathlib import Path

root = Path.cwd()

files = [
    p
    for p in sorted(root.rglob('*.sqlite'))
    if 'data' in [part.lower() for part in p.parts]
    and 'node_modules' not in [part.lower() for part in p.parts]
]

result = []

for path in files:
    st = path.stat()
    info = {
        'path': str(path),
        'size': st.st_size,
        'created': datetime.utcfromtimestamp(st.st_ctime).isoformat() + 'Z',
        'modified': datetime.utcfromtimestamp(st.st_mtime).isoformat() + 'Z',
        'tables': [],
        'counts': {},
        'errors': None,
    }
    try:
        conn = sqlite3.connect(str(path))
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        info['tables'] = tables
        for table in ['sports', 'providers', 'channels', 'competitions', 'matches', 'streams']:
            if table in tables:
                try:
                    cursor.execute(f'SELECT COUNT(*) FROM {table}')
                    info['counts'][table] = cursor.fetchone()[0]
                except Exception as err:
                    info['counts'][table] = f'ERROR: {err}'
            else:
                info['counts'][table] = None
        conn.close()
    except Exception as err:
        info['errors'] = str(err)
    result.append(info)

print(json.dumps(result, indent=2))
