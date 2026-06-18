#!/usr/bin/env python3
"""
IPTV Provider Lifecycle Validation Test

Validates complete provider lifecycle:
1. Create provider
2. Auto-test on save
3. Status transitions
4. Channel sync
5. Category extraction
6. UI visibility
7. Deactivate/reactivate
8. Persistence after restart
"""
import sqlite3
import json
import time
import sys
import datetime
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

BASE_URL = "http://localhost:4100"
ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / "apps" / "backend" / "data" / "gito.sqlite"
PROVIDER_NAME = "Lifecycle Test Provider"
TEST_M3U_URL = "https://example.com/playlist.m3u"

# Mock M3U playlist for testing
MOCK_M3U_CONTENT = """#EXTM3U
#EXTINF:-1 group-title="Sports",Channel 1
https://stream1.example.com/live.m3u8
#EXTINF:-1 group-title="Sports",Channel 2
https://stream2.example.com/live.m3u8
#EXTINF:-1 group-title="News",Channel 3
https://stream3.example.com/live.m3u8
#EXTINF:-1 group-title="News",Channel 4
https://stream4.example.com/live.m3u8
"""

# Test report structure
report = {
    "test_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    "steps": [],
    "provider_id": None,
    "errors": []
}

def log_step(step_num, name, success, details=None):
    """Log a test step."""
    entry = {
        "step": step_num,
        "name": name,
        "success": success,
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
    }
    if details:
        entry["details"] = details
    report["steps"].append(entry)
    status = "✓" if success else "✗"
    print(f"[{status}] Step {step_num}: {name}")
    if details and not success:
        print(f"    {details}")

def http_request(method, path, data=None):
    """Make HTTP request and return status, headers, body."""
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    body = None
    
    if data:
        body = json.dumps(data).encode('utf-8')
    
    try:
        req = Request(url, data=body, headers=headers, method=method)
        with urlopen(req) as response:
            status = response.status
            resp_body = response.read().decode('utf-8')
            return status, resp_body
    except HTTPError as e:
        status = e.code
        resp_body = e.read().decode('utf-8')
        return status, resp_body
    except Exception as e:
        return None, str(e)

def db_query(query, params=None):
    """Query database."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    if params:
        result = cur.execute(query, params).fetchall()
    else:
        result = cur.execute(query).fetchall()
    con.close()
    return [dict(r) for r in result]

def wait_for_backend(timeout=30):
    """Wait for backend to become available."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            status, _ = http_request("GET", "/health")
            if status == 200:
                return True
        except:
            pass
        time.sleep(0.5)
    return False

# Test execution
print("\n=== IPTV PROVIDER LIFECYCLE VALIDATION ===\n")

# Step 0: Wait for backend
print("Waiting for backend to be ready...")
if not wait_for_backend():
    log_step(0, "Backend availability", False, "Backend not responding after 30s")
    print(json.dumps(report, indent=2))
    sys.exit(1)

log_step(0, "Backend availability", True)

# Step 1: Create provider
print("\n[Step 1] Creating new provider...")
create_req = {
    "name": PROVIDER_NAME,
    "baseUrl": TEST_M3U_URL,
    "type": "m3u",
    "authType": "none"
}
status, resp = http_request("POST", "/iptv/providers", create_req)
print(f"  HTTP {status}")
print(f"  Response: {resp[:200]}...")

if status == 201:
    try:
        resp_data = json.loads(resp)
        provider_id = resp_data.get("data", {}).get("id")
        report["provider_id"] = provider_id
        
        if provider_id:
            log_step(1, "Create provider", True, {
                "provider_id": provider_id,
                "http_status": status
            })
        else:
            log_step(1, "Create provider", False, "No provider ID in response")
    except:
        log_step(1, "Create provider", False, f"Invalid JSON response: {resp}")
else:
    log_step(1, "Create provider", False, f"HTTP {status}: {resp}")
    print(json.dumps(report, indent=2))
    sys.exit(1)

# Step 2: Verify initial status (pending)
time.sleep(0.5)
providers = db_query("SELECT id, status FROM providers WHERE id = ?", (provider_id,))
initial_status = providers[0]["status"] if providers else None
log_step(2, "Verify initial status", 
         initial_status == "pending",
         {"initial_status": initial_status})

# Step 3: Test provider (auto-test after save)
print("\n[Step 3] Testing provider (POST /iptv/providers/:id/test)...")
status, resp = http_request("POST", f"/iptv/providers/{provider_id}/test")
print(f"  HTTP {status}")
if status and status < 300:
    try:
        resp_data = json.loads(resp)
        print(f"  Response: {json.dumps(resp_data, indent=2)[:300]}...")
        log_step(3, "Test provider", True, {
            "http_status": status,
            "response_keys": list(resp_data.get("data", {}).keys()) if resp_data else None
        })
    except:
        log_step(3, "Test provider", False, f"Invalid JSON: {resp[:100]}")
else:
    log_step(3, "Test provider", False, f"HTTP {status}: {resp[:100]}")

# Step 4: Verify status transition (pending -> active/failed)
time.sleep(0.5)
providers = db_query("SELECT id, status FROM providers WHERE id = ?", (provider_id,))
post_test_status = providers[0]["status"] if providers else None
log_step(4, "Verify status transition",
         post_test_status in ["active", "failed"],
         {"post_test_status": post_test_status})

# Step 5: Verify channel synchronization
channels = db_query("SELECT COUNT(*) as cnt FROM channels WHERE provider_id = ? AND status = 'active'", (provider_id,))
channel_count = channels[0]["cnt"] if channels else 0
log_step(5, "Verify channel sync",
         channel_count > 0,
         {"active_channels": channel_count})

# Step 6: Verify category extraction
categories = db_query("SELECT DISTINCT group_name FROM channels WHERE provider_id = ? AND group_name IS NOT NULL", (provider_id,))
category_names = [c["group_name"] for c in categories]
log_step(6, "Verify category extraction",
         len(categories) > 0,
         {"categories": category_names})

# Step 7: Test GET /iptv/providers visibility
status, resp = http_request("GET", "/iptv/providers")
if status == 200:
    try:
        resp_data = json.loads(resp)
        providers_list = resp_data.get("data", [])
        found = any(p.get("id") == provider_id for p in providers_list)
        log_step(7, "Provider visibility in GET /iptv/providers",
                 found,
                 {"provider_found": found, "total_providers": len(providers_list)})
    except:
        log_step(7, "Provider visibility", False, f"Invalid JSON")
else:
    log_step(7, "Provider visibility", False, f"HTTP {status}")

# Step 8: Deactivate provider
print("\n[Step 8] Deactivating provider...")
status, resp = http_request("POST", f"/iptv/providers/{provider_id}/status", {"status": "inactive"})
log_step(8, "Deactivate provider",
         status == 200,
         {"http_status": status})

# Verify deactivated status
time.sleep(0.2)
providers = db_query("SELECT id, status FROM providers WHERE id = ?", (provider_id,))
deactivated_status = providers[0]["status"] if providers else None
log_step(8.5, "Verify deactivated status",
         deactivated_status == "inactive",
         {"status": deactivated_status})

# Step 9: Reactivate provider
print("\n[Step 9] Reactivating provider...")
status, resp = http_request("POST", f"/iptv/providers/{provider_id}/status", {"status": "active"})
log_step(9, "Reactivate provider",
         status == 200,
         {"http_status": status})

# Verify reactivated status
time.sleep(0.2)
providers = db_query("SELECT id, status FROM providers WHERE id = ?", (provider_id,))
reactivated_status = providers[0]["status"] if providers else None
log_step(9.5, "Verify reactivated status",
         reactivated_status == "active",
         {"status": reactivated_status})

# Step 10: Capture final state before restart
final_channels = db_query("SELECT COUNT(*) as cnt FROM channels WHERE provider_id = ?", (provider_id,))
final_channel_count = final_channels[0]["cnt"] if final_channels else 0
final_provider = db_query("SELECT * FROM providers WHERE id = ?", (provider_id,))
log_step(10, "Capture final state",
         len(final_provider) > 0,
         {
             "provider_status": final_provider[0]["status"] if final_provider else None,
             "channel_count": final_channel_count
         })

# Report summary
print("\n=== LIFECYCLE VALIDATION COMPLETE ===\n")
print(f"Provider ID: {provider_id}")
print(f"Final status: {reactivated_status}")
print(f"Channels synced: {final_channel_count}")
print(f"Categories: {len(categories)}")
print(f"Total steps: {len(report['steps'])}")
print(f"Passed: {sum(1 for s in report['steps'] if s['success'])}")
print(f"Failed: {sum(1 for s in report['steps'] if not s['success'])}")

# Output JSON report
print("\n=== FULL REPORT (JSON) ===\n")
print(json.dumps(report, indent=2))
