import { getDatabase } from "../db/connection.js";

export type IptvProviderRow = {
  id: string;
  name: string;
  type: string;
  server_url: string;
  encrypted_credentials: string | null;
  expires_at: string | null;
  enabled: number;
  health_status: string;
  last_refresh_at: string | null;
  total_channels: number;
  created_at: string;
  updated_at: string;
};

export type IptvChannelRow = {
  id: string;
  provider_id: string;
  provider_channel_id: string | null;
  name: string;
  logo_url: string | null;
  category: string | null;
  language: string | null;
  country: string | null;
  resolution: string | null;
  stream_url: string;
  checksum: string | null;
  created_at: string;
  updated_at: string;
};

export class IptvRepository {
  static createProvider(row: Partial<IptvProviderRow>) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = row.id ?? ("prov_" + cryptoRandomId());
    db.prepare(`INSERT INTO iptv_providers (id, name, type, server_url, encrypted_credentials, expires_at, enabled, health_status, last_refresh_at, total_channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        row.name,
        row.type,
        row.server_url,
        row.encrypted_credentials ?? null,
        row.expires_at ?? null,
        row.enabled ?? 1,
        row.health_status ?? 'unknown',
        row.last_refresh_at ?? null,
        row.total_channels ?? 0,
        now,
        now
      );

    return this.getProviderById(id);
  }

  static updateProvider(id: string, patch: Partial<IptvProviderRow>) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const existing = this.getProviderById(id);
    if (!existing) return null;

    const updated = {
      name: patch.name ?? existing.name,
      type: patch.type ?? existing.type,
      server_url: patch.server_url ?? existing.server_url,
      encrypted_credentials: patch.encrypted_credentials ?? existing.encrypted_credentials,
      expires_at: patch.expires_at ?? existing.expires_at,
      enabled: typeof patch.enabled === 'number' ? patch.enabled : existing.enabled,
      health_status: patch.health_status ?? existing.health_status,
      last_refresh_at: patch.last_refresh_at ?? existing.last_refresh_at,
      total_channels: typeof patch.total_channels === 'number' ? patch.total_channels : existing.total_channels
    };

    db.prepare(`UPDATE iptv_providers SET name = ?, type = ?, server_url = ?, encrypted_credentials = ?, expires_at = ?, enabled = ?, health_status = ?, last_refresh_at = ?, total_channels = ?, updated_at = ? WHERE id = ?`)
      .run(updated.name, updated.type, updated.server_url, updated.encrypted_credentials, updated.expires_at, updated.enabled, updated.health_status, updated.last_refresh_at, updated.total_channels, now, id);

    return this.getProviderById(id);
  }

  static getProviderById(id: string): IptvProviderRow | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM iptv_providers WHERE id = ?`).get(id) as IptvProviderRow | undefined;
    return row ?? null;
  }

  static listProviders(): IptvProviderRow[] {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM iptv_providers ORDER BY name`).all() as IptvProviderRow[];
  }

  static deleteProvider(id: string) {
    const db = getDatabase();
    db.prepare(`DELETE FROM iptv_channel_index WHERE provider_id = ?`).run(id);
    db.prepare(`DELETE FROM iptv_channels WHERE provider_id = ?`).run(id);
    const result = db.prepare(`DELETE FROM iptv_providers WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  static upsertChannel(row: Partial<IptvChannelRow>) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = row.id ?? ("chan_" + cryptoRandomId());
    const exists = db.prepare(`SELECT id FROM iptv_channels WHERE id = ?`).get(id);

    if (exists) {
      db.prepare(`UPDATE iptv_channels SET provider_id = ?, provider_channel_id = ?, name = ?, logo_url = ?, category = ?, language = ?, country = ?, resolution = ?, stream_url = ?, checksum = ?, updated_at = ? WHERE id = ?`)
        .run(row.provider_id, row.provider_channel_id ?? null, row.name, row.logo_url ?? null, row.category ?? null, row.language ?? null, row.country ?? null, row.resolution ?? null, row.stream_url, row.checksum ?? null, now, id);
      db.prepare(`UPDATE iptv_channel_index SET name = ?, provider_id = ?, category = ?, checksum = ?, updated_at = ? WHERE id = ?`)
        .run(row.name, row.provider_id, row.category ?? null, row.checksum ?? null, now, id);
    } else {
      db.prepare(`INSERT INTO iptv_channels (id, provider_id, provider_channel_id, name, logo_url, category, language, country, resolution, stream_url, checksum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, row.provider_id, row.provider_channel_id ?? null, row.name, row.logo_url ?? null, row.category ?? null, row.language ?? null, row.country ?? null, row.resolution ?? null, row.stream_url, row.checksum ?? null, now, now);
      db.prepare(`INSERT OR REPLACE INTO iptv_channel_index (id, name, provider_id, category, checksum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, row.name, row.provider_id, row.category ?? null, row.checksum ?? null, now, now);
    }

    return this.getChannelById(id);
  }

  static getChannelById(id: string): IptvChannelRow | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM iptv_channels WHERE id = ?`).get(id) as IptvChannelRow | undefined;
    return row ?? null;
  }

  static listChannelsByProvider(providerId: string): IptvChannelRow[] {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM iptv_channels WHERE provider_id = ? ORDER BY name`).all(providerId) as IptvChannelRow[];
  }

  static searchChannels(q: string, limit = 50) {
    const db = getDatabase();
    const like = `%${q}%`;
    return db.prepare(`SELECT * FROM iptv_channel_index WHERE name LIKE ? OR category LIKE ? LIMIT ?`).all(like, like, limit) as any[];
  }

  static findChannelByProviderIdAndProviderChannelId(providerId: string, providerChannelId: string | null) {
    if (!providerChannelId) {
      return null;
    }
    const db = getDatabase();
    return db.prepare(`SELECT * FROM iptv_channels WHERE provider_id = ? AND provider_channel_id = ?`).get(providerId, providerChannelId) as IptvChannelRow | null;
  }

  static findChannelByProviderIdAndChecksum(providerId: string, checksum: string) {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM iptv_channels WHERE provider_id = ? AND checksum = ?`).get(providerId, checksum) as IptvChannelRow | null;
  }

  static listChannels(mode: "active" | "includeInactive" | "debug" | "raw" = "active", opts?: { providerId?: string; q?: string; category?: string }): IptvChannelRow[] {
    const db = getDatabase();
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts?.providerId) {
      conditions.push("provider_id = ?");
      params.push(opts.providerId);
    }

    if (opts?.category) {
      conditions.push("category = ?");
      params.push(opts.category);
    }

    if (opts?.q) {
      conditions.push("(name LIKE ? OR category LIKE ? OR stream_url LIKE ?)");
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }

    const where = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
    const sql = `SELECT * FROM iptv_channels WHERE ${where} ORDER BY name`;
    return db.prepare(sql).all(...params) as IptvChannelRow[];
  }

  static listCategories(providerId?: string): string[] {
    const db = getDatabase();
    if (providerId) {
      const rows = db.prepare(`SELECT DISTINCT category FROM iptv_channels WHERE provider_id = ? AND category IS NOT NULL ORDER BY category`).all(providerId) as { category: string }[];
      return rows.map((row) => row.category);
    }

    const rows = db.prepare(`SELECT DISTINCT category FROM iptv_channels WHERE category IS NOT NULL ORDER BY category`).all() as { category: string }[];
    return rows.map((row) => row.category);
  }

  static getProviderChannelDiagnostics(providerId: string) {
    const provider = this.getProviderById(providerId);
    if (!provider) {
      return null;
    }

    const db = getDatabase();
    const counts = db.prepare(`SELECT COUNT(*) AS total FROM iptv_channels WHERE provider_id = ?`).get(providerId) as { total: number };
    const total = Number(counts.total ?? 0);

    return {
      providerId,
      status: provider.enabled ? (provider.health_status === 'failed' ? 'failed' : 'active') : 'inactive',
      availabilityStatus: provider.health_status ?? 'unknown',
      healthScore: 0,
      syncMode: undefined,
      lastSuccessfulStreamLoadAt: provider.last_refresh_at ?? undefined,
      totalChannels: total,
      counts: {
        active: total,
        inactive: 0,
        stale: 0,
        archived: 0
      }
    };
  }

  static refreshProviderChannelCount(providerId: string) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const row = db.prepare(`SELECT COUNT(*) AS total FROM iptv_channels WHERE provider_id = ?`).get(providerId) as { total: number };
    const total = Number(row?.total ?? 0);
    db.prepare(`UPDATE iptv_providers SET total_channels = ?, updated_at = ? WHERE id = ?`).run(total, now, providerId);
  }

  static getLatestIngestionReport(_providerId: string) {
    return undefined;
  }

  static getParityDiagnostics(providerId: string) {
    const provider = this.getProviderById(providerId);
    if (!provider) {
      return undefined;
    }

    const db = getDatabase();
    const countRow = db.prepare(`SELECT COUNT(*) AS count FROM iptv_channels WHERE provider_id = ?`).get(providerId) as { count: number };
    const active = Number(countRow.count ?? 0);

    return {
      providerId,
      giToChannelCount: {
        active,
        includeInactive: active,
        raw: active
      },
      ingestionReport: undefined,
      mismatchAnalysis: {
        totalRejected: 0,
        totalDuplicates: 0,
        totalInactiveMarked: 0,
        mismatchReasons: []
      },
      recommendations: active === 0 ? ["No channels found for this provider. Run a sync or import operation."] : []
    };
  }
}

function cryptoRandomId() {
  return (Math.random().toString(36).slice(2, 10) + Date.now().toString(36)).slice(0, 32);
}
