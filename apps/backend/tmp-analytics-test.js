const base = 'http://127.0.0.1:4100';
const events = [
  { eventType: 'app_open', sessionId: 'session-001', payload: { source: 'manual' } },
  { eventType: 'user_login', sessionId: 'session-001', payload: { method: 'password' } },
  { eventType: 'match_view', sessionId: 'session-002', matchId: 'match-abc', payload: { page: 'schedule' } },
  { eventType: 'stream_start', sessionId: 'session-002', matchId: 'match-abc', payload: { quality: 'hd', watchTime: 120 } },
  { eventType: 'stream_end', sessionId: 'session-002', matchId: 'match-abc', payload: { watchTime: 120 } },
  { eventType: 'reward_completed', sessionId: 'session-003', payload: { rewardType: 'video', amount: 50 } },
];

async function postEvents() {
  for (const event of events) {
    const res = await fetch(`${base}/analytics/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    console.log('EVENT POST', event.eventType, res.status, await res.text());
  }

  const adEvents = [
    { promotionId: 'promo-support-gito', eventType: 'ad_impression', sessionId: 'session-004', matchId: 'match-abc', metadata: { placement: 'banner' } },
    { promotionId: 'promo-support-gito', eventType: 'ad_click', sessionId: 'session-004', matchId: 'match-abc', metadata: { placement: 'banner' } },
  ];

  for (const event of adEvents) {
    const res = await fetch(`${base}/analytics/ad-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    console.log('AD EVENT POST', event.eventType, res.status, await res.text());
  }

  for (const path of ['overview', 'streams', 'users', 'ads']) {
    const res = await fetch(`${base}/analytics/${path}`);
    console.log(`GET /analytics/${path}`, res.status, await res.text());
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database('data/gito.sqlite', { readonly: true });

  const rows = db.prepare('SELECT id, event_type, session_id, match_id, payload, user_agent, ip_address, created_at FROM mobile_analytics_events ORDER BY created_at DESC LIMIT 20').all();
  console.log('EVENT ROWS:', JSON.stringify(rows, null, 2));

  const adRows = db.prepare('SELECT id, promotion_id, event_type, session_id, match_id, metadata, created_at FROM mobile_ad_events ORDER BY created_at DESC LIMIT 20').all();
  console.log('AD EVENT ROWS:', JSON.stringify(adRows, null, 2));
}

postEvents().catch((error) => {
  console.error('TEST SCRIPT FAILED', error);
  process.exit(1);
});
