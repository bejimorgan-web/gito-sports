import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-countries-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { createCountry, deleteCountry, listCountries } = await import("./countries-repository.js");
const { getDatabase } = await import("../db/connection.js");

function seedCountry() {
  return createCountry({ name: "United Kingdom", iso2Code: "GB", iso3Code: "GBR" });
}

test("country creation normalizes and rejects duplicate ISO2/ISO3 codes", () => {
  seedCountry();

  const spain = createCountry({ name: "  Spain  ", iso2Code: " es ", iso3Code: " esp " });
  assert.equal(spain.name, "Spain");
  assert.equal(spain.iso2Code, "ES");
  assert.equal(spain.iso3Code, "ESP");
  assert.equal(listCountries().length, 2);
  assert.equal(deleteCountry(spain.id), true);

  assert.throws(
    () => createCountry({ name: "United Kingdom Duplicate", iso2Code: " gb ", iso3Code: "USA" }),
    (error: any) => error?.code === "country_already_exists" && /United Kingdom already exists/i.test(error.message)
  );

  assert.throws(
    () => createCountry({ name: "United States", iso2Code: "US", iso3Code: " gbr " }),
    (error: any) => error?.code === "country_already_exists" && /United Kingdom already exists/i.test(error.message)
  );

  assert.equal(listCountries().length, 1);

  const country = listCountries()[0]!;
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'club', 'active', ?, ?)").run("country-test-team", null, country.id, "Country Test FC", "country-test-fc", now, now);
  assert.throws(() => deleteCountry(country.id), (error: any) => error?.code === "country_in_use" && /clubs/i.test(error.message));
});

test.after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${databasePath}${suffix}`);
    } catch {
      // temporary test artifact
    }
  }
});
