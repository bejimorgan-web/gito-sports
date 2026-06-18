#!/usr/bin/env python3
"""
PHASE 1: Recover Sports Data from Backup

This script safely recovers the 12 missing sports from the backup database
to the production database. It performs comprehensive verification before
and after the recovery.

SAFETY MEASURES:
- Creates backup of current database first
- Verifies both databases are valid
- Checks data integrity before/after
- Provides detailed logging
- Allows rollback if needed
"""

import sqlite3
import shutil
import os
import json
from datetime import datetime

PRODUCTION_DB = "data/gito.sqlite"
BACKUP_DB = "data/gito-backup-20260601-200650.sqlite"
TIMESTAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
CORRUPTED_BACKUP = f"data/gito-corrupted-{TIMESTAMP}.sqlite"

def log(msg: str):
    """Print timestamped log message"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")

def verify_database(db_path: str, name: str) -> bool:
    """Verify database integrity"""
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check all required tables exist
        c.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name IN 
            ('sports', 'providers', 'channels', 'competitions', 'matches', 'streams')
        """)
        tables = [row[0] for row in c.fetchall()]
        required = {'sports', 'providers', 'channels', 'competitions', 'matches', 'streams'}
        
        if not required.issubset(set(tables)):
            log(f"❌ {name}: Missing tables: {required - set(tables)}")
            return False
        
        # Verify database integrity
        c.execute("PRAGMA integrity_check")
        result = c.fetchone()[0]
        if result != "ok":
            log(f"❌ {name}: Integrity check failed: {result}")
            return False
        
        log(f"✅ {name}: Database integrity verified")
        conn.close()
        return True
    except Exception as e:
        log(f"❌ {name}: Error - {e}")
        return False

def get_counts(db_path: str) -> dict:
    """Get row counts from database"""
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        counts = {}
        
        for table in ['sports', 'providers', 'channels', 'competitions', 'matches', 'streams']:
            c.execute(f"SELECT COUNT(*) FROM {table}")
            counts[table] = c.fetchone()[0]
        
        conn.close()
        return counts
    except Exception as e:
        log(f"Error getting counts: {e}")
        return {}

def get_sports(db_path: str) -> list:
    """Get sports data from database"""
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports")
        sports = c.fetchall()
        conn.close()
        return sports
    except Exception as e:
        log(f"Error getting sports: {e}")
        return []

def recover_sports():
    """Execute sports recovery"""
    
    log("=" * 70)
    log("PHASE 1: SPORTS DATA RECOVERY")
    log("=" * 70)
    
    # Step 1: Verify files exist
    log("\n[Step 1] Verifying database files exist...")
    if not os.path.exists(PRODUCTION_DB):
        log(f"❌ Production DB not found: {PRODUCTION_DB}")
        return False
    if not os.path.exists(BACKUP_DB):
        log(f"❌ Backup DB not found: {BACKUP_DB}")
        return False
    log("✅ Both database files found")
    
    # Step 2: Verify databases are valid
    log("\n[Step 2] Verifying database integrity...")
    if not verify_database(PRODUCTION_DB, "Production DB"):
        return False
    if not verify_database(BACKUP_DB, "Backup DB"):
        return False
    
    # Step 3: Get pre-recovery counts
    log("\n[Step 3] Checking pre-recovery state...")
    prod_counts = get_counts(PRODUCTION_DB)
    backup_counts = get_counts(BACKUP_DB)
    
    log(f"\nProduction DB sports: {prod_counts.get('sports', '?')}")
    log(f"Backup DB sports: {backup_counts.get('sports', '?')}")
    log(f"Production DB providers: {prod_counts.get('providers', '?')}")
    log(f"Production DB channels: {prod_counts.get('channels', '?')}")
    
    if prod_counts.get('sports', 0) > 0:
        log("⚠️  Production DB already has sports - recovery may not be needed")
        return True
    
    if backup_counts.get('sports', 0) == 0:
        log("❌ Backup DB has no sports - cannot recover")
        return False
    
    # Step 4: Create safety backup
    log(f"\n[Step 4] Creating safety backup...")
    try:
        shutil.copy2(PRODUCTION_DB, CORRUPTED_BACKUP)
        log(f"✅ Backup created: {CORRUPTED_BACKUP}")
    except Exception as e:
        log(f"❌ Failed to create backup: {e}")
        return False
    
    # Step 5: Get sports data from backup
    log("\n[Step 5] Extracting sports from backup...")
    sports = get_sports(BACKUP_DB)
    if not sports:
        log("❌ No sports found in backup DB")
        return False
    log(f"✅ Found {len(sports)} sports in backup")
    for sport in sports:
        log(f"   - {sport[1]} ({sport[2]})")
    
    # Step 6: Insert sports into production DB
    log("\n[Step 6] Inserting sports into production DB...")
    try:
        prod_conn = sqlite3.connect(PRODUCTION_DB)
        prod_c = prod_conn.cursor()
        
        for sport in sports:
            prod_c.execute("""
                INSERT OR REPLACE INTO sports 
                (id, name, slug, logo_url, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, sport)
        
        prod_conn.commit()
        log(f"✅ Inserted {len(sports)} sports")
        prod_conn.close()
    except Exception as e:
        log(f"❌ Failed to insert sports: {e}")
        return False
    
    # Step 7: Verify recovery
    log("\n[Step 7] Verifying recovery...")
    new_counts = get_counts(PRODUCTION_DB)
    new_sports = get_sports(PRODUCTION_DB)
    
    log(f"Production DB sports after recovery: {new_counts.get('sports', '?')}")
    
    if new_counts.get('sports', 0) != len(sports):
        log(f"❌ Recovery incomplete - expected {len(sports)}, got {new_counts.get('sports', 0)}")
        return False
    
    log(f"✅ Recovery successful - {len(new_sports)} sports restored")
    
    # Step 8: Verify data integrity post-recovery
    log("\n[Step 8] Verifying data integrity post-recovery...")
    try:
        prod_conn = sqlite3.connect(PRODUCTION_DB)
        prod_c = prod_conn.cursor()
        
        # Check competitions linked to sports
        prod_c.execute("""
            SELECT COUNT(DISTINCT c.sport_id) FROM competitions c
            JOIN sports s ON s.id = c.sport_id
        """)
        comp_with_sports = prod_c.fetchone()[0]
        
        # Check matches linked to competitions
        prod_c.execute("""
            SELECT COUNT(DISTINCT m.competition_id) FROM matches m
            JOIN competitions c ON c.id = m.competition_id
        """)
        matches_with_comp = prod_c.fetchone()[0]
        
        # Check streams linked to matches
        prod_c.execute("""
            SELECT COUNT(DISTINCT s.match_id) FROM streams s
            JOIN matches m ON m.id = s.match_id
        """)
        streams_with_match = prod_c.fetchone()[0]
        
        prod_conn.close()
        
        log(f"✅ Competitions linked to sports: {comp_with_sports}")
        log(f"✅ Matches linked to competitions: {matches_with_comp}")
        log(f"✅ Streams linked to matches: {streams_with_match}")
    except Exception as e:
        log(f"❌ Error verifying data integrity: {e}")
        return False
    
    log("\n" + "=" * 70)
    log("✅ PHASE 1 COMPLETE: SPORTS DATA RECOVERED SUCCESSFULLY")
    log("=" * 70)
    log(f"\nSafety backup (if needed): {CORRUPTED_BACKUP}")
    log("To rollback: cp {CORRUPTED_BACKUP} {PRODUCTION_DB}")
    
    return True

if __name__ == "__main__":
    import sys
    
    try:
        success = recover_sports()
        sys.exit(0 if success else 1)
    except Exception as e:
        log(f"❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
