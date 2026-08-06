const base = 'http://localhost:4100';

async function run() {
  try {
    const h = await fetch(`${base}/health`);
    console.log('HEALTH', await h.text());

    const provResp = await fetch(`${base}/iptv/providers`);
    console.log('GET PROVIDERS', JSON.stringify(await provResp.json()));

    const create = await fetch(`${base}/iptv/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-prov-' + Date.now(), baseUrl: 'http://example.com/playlist.m3u', type: 'm3u' })
    });
    const created = await create.json();
    console.log('CREATE', JSON.stringify(created));
    const id = created?.data?.id ?? created?.data?.providerId ?? created?.data?.id;
    if (!id) {
      console.error('No provider id in create response');
      return;
    }

    const put = await fetch(`${base}/iptv/providers/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-prov-updated' })
    });
    console.log('PUT', JSON.stringify(await put.json()));

    const del = await fetch(`${base}/iptv/providers/${id}`, { method: 'DELETE' });
    console.log('DELETE', del.status);

    const channels = await fetch(`${base}/iptv/channels`);
    console.log('CHANNELS', JSON.stringify(await channels.json()));
  } catch (e) {
    console.error('ERR', e);
  }
}

run();
