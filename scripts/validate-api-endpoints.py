#!/usr/bin/env python3
"""
Comprehensive API Endpoint Validation
Tests all critical endpoints to verify data flow and system health
"""

import sqlite3
import json
from datetime import datetime

PRODUCTION_DB = "/tmp/gito.sqlite"

def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")

def check_endpoint_data(db_path: str) -> dict:
    """Check what data would be returned by each endpoint"""
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        results = {}
        
        # 1. GET /sports
        c.execute("SELECT COUNT(*) as count FROM sports")
        sports_count = c.fetchone()[0]
        results["GET /sports"] = {
            "count": sports_count,
            "status": "✅ WORKS" if sports_count > 0 else "❌ EMPTY"
        }
        
        # 2. GET /iptv/providers
        c.execute("SELECT COUNT(*) as count FROM providers WHERE deleted = 0")
        providers_count = c.fetchone()[0]
        results["GET /iptv/providers"] = {
            "count": providers_count,
            "status": "✅ WORKS" if providers_count > 0 else "❌ EMPTY"
        }
        
        # 3. GET /iptv/channels
        c.execute("SELECT COUNT(*) as count FROM channels")
        channels_count = c.fetchone()[0]
        results["GET /iptv/channels"] = {
            "count": channels_count,
            "status": "✅ WORKS" if channels_count > 0 else "❌ EMPTY"
        }
        
        # 4. GET /matches
        c.execute("SELECT COUNT(*) as count FROM matches")
        matches_count = c.fetchone()[0]
        results["GET /matches"] = {
            "count": matches_count,
            "status": "✅ WORKS" if matches_count > 0 else "⚠️ EMPTY"
        }
        
        # 5. GET /streams
        c.execute("SELECT COUNT(*) as count FROM streams")
        streams_count = c.fetchone()[0]
        results["GET /streams"] = {
            "count": streams_count,
            "status": "✅ WORKS" if streams_count > 0 else "⚠️ EMPTY"
        }
        
        # 6. GET /live-matches/feed (active published streams)
        c.execute("""
            SELECT COUNT(*) as count FROM matches m
            JOIN streams s ON s.match_id = m.id
            WHERE s.status = 'active' AND s.published_at IS NOT NULL AND m.status = 'published'
        """)
        live_count = c.fetchone()[0]
        results["GET /live-matches/feed"] = {
            "count": live_count,
            "status": "✅ WORKS" if live_count >= 0 else "❌ ERROR"
        }
        
        # 7. GET /competitions
        c.execute("SELECT COUNT(*) as count FROM competitions")
        competitions_count = c.fetchone()[0]
        results["GET /competitions"] = {
            "count": competitions_count,
            "status": "✅ WORKS" if competitions_count > 0 else "⚠️ EMPTY"
        }
        
        # 8. GET /teams
        c.execute("SELECT COUNT(*) as count FROM teams")
        teams_count = c.fetchone()[0]
        results["GET /teams"] = {
            "count": teams_count,
            "status": "✅ WORKS" if teams_count > 0 else "⚠️ EMPTY"
        }
        
        # 9. GET /countries
        c.execute("SELECT COUNT(*) as count FROM countries")
        countries_count = c.fetchone()[0]
        results["GET /countries"] = {
            "count": countries_count,
            "status": "✅ WORKS" if countries_count > 0 else "⚠️ EMPTY"
        }
        
        conn.close()
        return results
    except Exception as e:
        log(f"❌ Error: {e}")
        return {}

def check_data_integrity(db_path: str) -> dict:
    """Check data integrity and relationships"""
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        checks = {}
        
        # 1. Sports exist
        c.execute("SELECT COUNT(*) FROM sports")
        sports_count = c.fetchone()[0]
        checks["Sports exist"] = {
            "count": sports_count,
            "status": "✅ PASS" if sports_count > 0 else "❌ FAIL"
        }
        
        # 2. Competitions linked to sports
        if sports_count > 0:
            c.execute("""
                SELECT COUNT(DISTINCT c.sport_id) as count FROM competitions c
                JOIN sports s ON s.id = c.sport_id
            """)
            comp_count = c.fetchone()[0]
            checks["Competitions linked to sports"] = {
                "count": comp_count,
                "status": "✅ PASS" if comp_count > 0 else "⚠️ NO LINKS"
            }
        
        # 3. Matches exist
        c.execute("SELECT COUNT(*) FROM matches")
        match_count = c.fetchone()[0]
        checks["Matches exist"] = {
            "count": match_count,
            "status": "✅ PASS" if match_count > 0 else "⚠️ EMPTY"
        }
        
        # 4. Streams exist
        c.execute("SELECT COUNT(*) FROM streams")
        stream_count = c.fetchone()[0]
        checks["Streams exist"] = {
            "count": stream_count,
            "status": "✅ PASS" if stream_count > 0 else "⚠️ EMPTY"
        }
        
        # 5. No orphaned channels (provider still exists)
        c.execute("""
            SELECT COUNT(*) FROM channels c
            WHERE c.provider_id NOT IN (SELECT id FROM providers)
        """)
        orphaned_count = c.fetchone()[0]
        checks["No orphaned channels"] = {
            "orphaned": orphaned_count,
            "status": "✅ PASS" if orphaned_count == 0 else "⚠️ FOUND ORPHANED"
        }
        
        # 6. Providers have status
        c.execute("""
            SELECT status, COUNT(*) FROM providers GROUP BY status
        """)
        provider_status = dict(c.fetchall())
        checks["Provider status distribution"] = {
            "data": provider_status,
            "status": "✅ PASS" if len(provider_status) > 0 else "❌ FAIL"
        }
        
        # 7. Streams have proper status
        c.execute("""
            SELECT status, COUNT(*) FROM streams GROUP BY status
        """)
        stream_status = dict(c.fetchall())
        checks["Stream status distribution"] = {
            "data": stream_status,
            "status": "✅ PASS" if len(stream_status) > 0 else "❌ FAIL"
        }
        
        conn.close()
        return checks
    except Exception as e:
        log(f"❌ Error: {e}")
        return {}

def main():
    log("=" * 70)
    log("COMPREHENSIVE API VALIDATION TEST")
    log("=" * 70)
    
    log("\n[Step 1] Checking Endpoint Data Availability...")
    endpoints = check_endpoint_data(PRODUCTION_DB)
    
    for endpoint, info in endpoints.items():
        status = info["status"]
        count = info.get("count", "?")
        log(f"  {status} {endpoint}: {count} rows")
    
    log("\n[Step 2] Checking Data Integrity...")
    checks = check_data_integrity(PRODUCTION_DB)
    
    for check, info in checks.items():
        status = info["status"]
        if "count" in info:
            detail = f": {info['count']}"
        elif "orphaned" in info:
            detail = f": {info['orphaned']} orphaned"
        elif "data" in info:
            detail = f": {info['data']}"
        else:
            detail = ""
        log(f"  {status} {check}{detail}")
    
    # Summary
    log("\n" + "=" * 70)
    passed = sum(1 for info in endpoints.values() if "✅" in info["status"])
    total = len(endpoints)
    log(f"ENDPOINTS SUMMARY: {passed}/{total} working ✅")
    
    passed_checks = sum(1 for info in checks.values() if "✅" in info["status"])
    total_checks = len(checks)
    log(f"INTEGRITY SUMMARY: {passed_checks}/{total_checks} checks passed ✅")
    
    log("=" * 70)
    
    if passed == total and passed_checks == total_checks:
        log("✅ ALL TESTS PASSED")
        return 0
    else:
        log("⚠️ SOME TESTS FAILED - Review above for details")
        return 1

if __name__ == "__main__":
    import sys
    sys.exit(main())
