const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('data/gito.sqlite');

const providers = db.prepare('SELECT id, name, type, status, availability_status, deleted FROM providers ORDER BY name').all();
console.log('PROVIDERS', JSON.stringify(providers, null, 2));

const counts = {
  iptv_categories: db.prepare('SELECT COUNT(*) AS count FROM iptv_categories').get().count,
  channels: db.prepare('SELECT COUNT(*) AS count FROM channels').get().count,
  iptv_movies: db.prepare('SELECT COUNT(*) AS count FROM iptv_movies').get().count,
  iptv_series: db.prepare('SELECT COUNT(*) AS count FROM iptv_series').get().count,
  iptv_seasons: db.prepare('SELECT COUNT(*) AS count FROM iptv_seasons').get().count,
  iptv_series_episodes: db.prepare('SELECT COUNT(*) AS count FROM iptv_series_episodes').get().count,
};
console.log('COUNTS', JSON.stringify(counts, null, 2));

if (providers.length) {
  for (const provider of providers) {
    const categorySummary = db.prepare('SELECT content_type, COUNT(*) AS count FROM iptv_categories WHERE provider_id = ? GROUP BY content_type ORDER BY content_type').all(provider.id);
    console.log('CATEGORY_SUMMARY', provider.id, JSON.stringify(categorySummary, null, 2));
    const channelSummary = db.prepare('SELECT content_type, COUNT(*) AS count FROM channels WHERE provider_id = ? GROUP BY content_type ORDER BY content_type').all(provider.id);
    console.log('CHANNEL_SUMMARY', provider.id, JSON.stringify(channelSummary, null, 2));
  }
}
