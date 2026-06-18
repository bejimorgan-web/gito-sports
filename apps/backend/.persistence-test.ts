const apiBase = "http://127.0.0.1:4100";
const providerId = "e0e3000b-ec6f-48ce-aae8-d7c5612a5a1a";
const channelIds = [
  "014bb738-5864-4587-82c2-47c837de37ca",
  "4363ceb8-0884-4317-87e4-13a6d7f8caab"
];

async function fetchJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function run() {
  const provider = await fetchJson(`/iptv/providers/${providerId}`);
  console.log("provider", JSON.stringify(provider));

  const channels = await fetchJson(`/iptv/channels?providerId=${providerId}`);
  console.log("channels", JSON.stringify(channels));

  const live = await fetchJson(`/mobile/matches/live`);
  console.log("live", JSON.stringify(live));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
