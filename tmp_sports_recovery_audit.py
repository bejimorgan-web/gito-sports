import json
import sqlite3
from pathlib import Path

base = Path.cwd()
runtime_path = base / "data" / "gito.sqlite"
backup_path = base / "data" / "gito-backup-20260601-200650.sqlite"

if not runtime_path.exists() or not backup_path.exists():
    raise FileNotFoundError(f"Missing runtime or backup DB: {runtime_path}, {backup_path}")


def read_sports(path):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("SELECT id, name, slug, status, created_at, updated_at FROM sports ORDER BY id")
    rows = cur.fetchall()
    conn.close()
    return rows

runtime_sports = read_sports(runtime_path)
backup_sports = read_sports(backup_path)

runtime_ids = {row[0] for row in runtime_sports}
backup_ids = {row[0] for row in backup_sports}
runtime_names = {row[1] for row in runtime_sports}
backup_names = {row[1] for row in backup_sports}

only_backup_ids = sorted(backup_ids - runtime_ids)
only_runtime_ids = sorted(runtime_ids - backup_ids)
only_backup_names = sorted(backup_names - runtime_names)
only_runtime_names = sorted(runtime_names - backup_names)


def count_in_db(db_path, table, column, ids):
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    if not ids:
        conn.close()
        return 0
    placeholders = ",".join("?" for _ in ids)
    cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} IN ({placeholders})", ids)
    value = cur.fetchone()[0]
    conn.close()
    return value

competitions_ref_backup = count_in_db(backup_path, "competitions", "sport_id", only_backup_ids)
teams_ref_backup = count_in_db(backup_path, "teams", "sport_id", only_backup_ids)
matches_ref_backup = count_in_db(backup_path, "scheduling_matches", "sport_id", only_backup_ids)
competitions_ref_runtime = count_in_db(runtime_path, "competitions", "sport_id", only_backup_ids)
teams_ref_runtime = count_in_db(runtime_path, "teams", "sport_id", only_backup_ids)
matches_ref_runtime = count_in_db(runtime_path, "scheduling_matches", "sport_id", only_backup_ids)

result = {
    "runtime_count": len(runtime_sports),
    "backup_count": len(backup_sports),
    "runtime_empty": len(runtime_sports) == 0,
    "only_backup_ids": only_backup_ids,
    "only_runtime_ids": only_runtime_ids,
    "only_backup_names": only_backup_names,
    "only_runtime_names": only_runtime_names,
    "backup_references": {
        "competitions": competitions_ref_backup,
        "teams": teams_ref_backup,
        "scheduling_matches": matches_ref_backup,
    },
    "runtime_references": {
        "competitions": competitions_ref_runtime,
        "teams": teams_ref_runtime,
        "scheduling_matches": matches_ref_runtime,
    },
}
print(json.dumps(result, indent=2))
