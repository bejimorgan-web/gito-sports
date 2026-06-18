import json, urllib.request
url = 'http://127.0.0.1:4100/sports'
payload = {
  'name': 'Trace Sport E2E',
  'logoUrl': 'http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png',
  'countryIds': []
}
req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req) as resp:
    print(resp.status)
    print(resp.read().decode())
