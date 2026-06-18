import os
import uuid
import urllib.request

path = os.path.join('apps', 'backend', 'data', 'uploads', '1780244145873-f1vx63.png')
boundary = '----WebKitFormBoundary' + uuid.uuid4().hex

parts = []
parts.append(b'--' + boundary.encode() + b'\r\n')
parts.append(b'Content-Disposition: form-data; name="file"; filename="test.png"\r\n')
parts.append(b'Content-Type: image/png\r\n\r\n')
with open(path, 'rb') as f:
    parts.append(f.read())
parts.append(b'\r\n--' + boundary.encode() + b'--\r\n')
body = b''.join(parts)

req = urllib.request.Request(
    'http://localhost:4100/upload/images',
    data=body,
    headers={
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': str(len(body)),
    },
)

with urllib.request.urlopen(req) as response:
    print(response.status)
    print(response.read().decode('utf-8', errors='replace'))
