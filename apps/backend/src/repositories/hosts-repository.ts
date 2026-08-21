import crypto from "node:crypto";

import type { CreateHostRequest, Host, HostType, UpdateHostRequest } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import { findCountryByName } from "./countries-repository.js";

const hostTypes: HostType[] = ["country", "organization", "federation", "association", "regional", "international", "other"];

type HostRow = {
  id: string;
  sport_id: string;
  name: string;
  host_type: HostType;
  country_id: string | null;
  logo_url: string | null;
  status: Host["status"];
  created_at: string;
  updated_at: string;
};

function now() {
  return new Date().toISOString();
}

function mapHost(row: HostRow): Host {
  return {
    id: row.id,
    sportId: row.sport_id,
    name: row.name,
    type: row.host_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.country_id ? { countryId: row.country_id } : {}),
    ...(row.logo_url ? { logoUrl: row.logo_url } : {})
  };
}

function validateHostInput(database: ReturnType<typeof getDatabase>, sportId: string, name: string, type: HostType, countryId?: string | null) {
  if (!database.prepare("SELECT id FROM sports WHERE id = ?").get(sportId)) {
    throw new Error("sport_not_found");
  }
  if (!name.trim()) {
    throw new Error("host_name_required");
  }
  if (!hostTypes.includes(type)) {
    throw new Error("host_type_invalid");
  }
  if (type === "country") {
    if (!countryId) {
      throw Object.assign(new Error("Select an existing country or create the country first."), { code: "country_host_country_not_found" });
    }
    if (!database.prepare("SELECT id FROM countries WHERE id = ?").get(countryId)) throw new Error("country_not_found");
  } else if (countryId) {
    throw new Error("non_country_host_cannot_reference_country");
  }
}

function getHost(hostId: string): Host | undefined {
  const row = getDatabase().prepare(
    "SELECT id, sport_id, name, host_type, country_id, logo_url, status, created_at, updated_at FROM hosts WHERE id = ?"
  ).get(hostId) as HostRow | undefined;
  return row ? mapHost(row) : undefined;
}

export function listHosts(sportId?: string): Host[] {
  const database = getDatabase();
  const rows = sportId
    ? database.prepare("SELECT id, sport_id, name, host_type, country_id, logo_url, status, created_at, updated_at FROM hosts WHERE sport_id = ? ORDER BY name").all(sportId)
    : database.prepare("SELECT id, sport_id, name, host_type, country_id, logo_url, status, created_at, updated_at FROM hosts ORDER BY sport_id, name").all();
  return (rows as HostRow[]).map(mapHost);
}

export function getHostById(hostId: string): Host | undefined {
  return getHost(hostId);
}

export function createHost(input: CreateHostRequest): Host {
  const database = getDatabase();
  const name = input.name.trim();
  const type = input.type ?? input.hostType;
  const countryId = type === "country" ? findCountryByName(name)?.id : undefined;
  validateHostInput(database, input.sportId, name, type as HostType, countryId);
  const duplicate = database.prepare("SELECT id FROM hosts WHERE sport_id = ? AND lower(name) = lower(?)").get(input.sportId, name);
  if (duplicate) throw new Error("host_duplicate");

  const id = crypto.randomUUID();
  const timestamp = now();
  database.prepare(
    "INSERT INTO hosts (id, sport_id, name, host_type, country_id, logo_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)"
  ).run(id, input.sportId, name, type, countryId ?? null, input.logoUrl ?? null, timestamp, timestamp);
  return getHost(id)!;
}

export function updateHost(hostId: string, input: UpdateHostRequest): Host | undefined {
  const database = getDatabase();
  const existing = database.prepare(
    "SELECT id, sport_id, name, host_type, country_id, logo_url, status, created_at, updated_at FROM hosts WHERE id = ?"
  ).get(hostId) as HostRow | undefined;
  if (!existing) return undefined;

  const name = input.name?.trim() || existing.name;
  const type = input.type ?? input.hostType ?? existing.host_type;
  const countryId = type === "country" ? findCountryByName(name)?.id : null;
  validateHostInput(database, existing.sport_id, name, type, countryId);
  const duplicate = database.prepare("SELECT id FROM hosts WHERE sport_id = ? AND lower(name) = lower(?) AND id != ?").get(existing.sport_id, name, hostId);
  if (duplicate) throw new Error("host_duplicate");

  database.prepare(
    "UPDATE hosts SET name = ?, host_type = ?, country_id = ?, logo_url = ?, status = ?, updated_at = ? WHERE id = ?"
  ).run(name, type, countryId ?? null, input.logoUrl !== undefined ? input.logoUrl : existing.logo_url, input.status ?? existing.status, now(), hostId);
  return getHost(hostId);
}

export function deleteHost(hostId: string): boolean {
  const database = getDatabase();
  if (!getHost(hostId)) return false;
  const usage = database.prepare("SELECT COUNT(*) AS count FROM competitions WHERE host_id = ?").get(hostId) as { count: number };
  if (usage.count > 0) {
    throw Object.assign(new Error("host_in_use"), { count: usage.count });
  }
  return database.prepare("DELETE FROM hosts WHERE id = ?").run(hostId).changes > 0;
}
