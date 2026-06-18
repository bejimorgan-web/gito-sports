const fs = require('fs');
const path = require('path');
const os = require('os');
const tmp = path.join(os.tmpdir(), 'gito-upload-test.png');
fs.writeFileSync(tmp, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
(async () => {
  try {
    const buffer = fs.readFileSync(tmp);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/png' }), 'test.png');
    const res = await fetch('http://localhost:4100/upload/images', {
      method: 'POST',
      body: form
    });
    console.log('status', res.status);
    console.log(await res.text());
  } catch (error) {
    console.error(error);
  } finally {
    fs.unlinkSync(tmp);
  }
})();
