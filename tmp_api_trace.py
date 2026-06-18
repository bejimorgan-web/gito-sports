import urllib.request
import urllib.error
import json

ports = [4100, 4101]
paths = ['/sports', '/iptv/providers', '/iptv/channels', '/matches', '/streams']
results = {}

for port in ports:
    results[port] = {}
    for path in paths:
        url = f'http://127.0.0.1:{port}{path}'
        entry = {'url': url}
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read().decode('utf-8')
                entry['status'] = resp.status
                entry['body'] = body
                try:
                    parsed = json.loads(body)
                except Exception as e:
                    parsed = None
                    entry['json_error'] = str(e)
                if isinstance(parsed, dict) and 'data' in parsed:
                    data = parsed['data']
                    if isinstance(data, list):
                        entry['count'] = len(data)
                    elif isinstance(data, dict):
                        entry['count'] = 1
                    else:
                        entry['count'] = None
                else:
                    entry['count'] = None
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode('utf-8')
            except Exception:
                body = ''
            entry['status'] = e.code
            entry['body'] = body
            entry['error'] = str(e)
        except Exception as e:
            entry['status'] = None
            entry['body'] = ''
            entry['error'] = str(e)
        results[port][path] = entry

print(json.dumps(results, indent=2))
