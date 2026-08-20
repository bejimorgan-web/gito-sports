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

test("country creation normalizes and rejects duplicate ISO2/ISO3 codes", () => {
  const countries = [
    createCountry({ name: " Spain ", iso2Code: " es ", iso3Code: " esp " }),
    createCountry({ name: "England", iso2Code: "GB", iso3Code: "GBR" }),
    createCountry({ name: "Germany", iso2Code: "DE", iso3Code: "DEU" }),
    createCountry({ name: "Italy", iso2Code: "IT", iso3Code: "ITA" }),
    createCountry({ name: "France", iso2Code: "FR", iso3Code: "FRA" })
  ];

  assert.deepEqual(countries.map((country) => country.name), ["Spain", "England", "Germany", "Italy", "France"]);
  assert.deepEqual(countries.map((country) => country.iso2Code), ["ES", "GB", "DE", "IT", "FR"]);
  assert.deepEqual(countries.map((country) => country.iso3Code), ["ESP", "GBR", "DEU", "ITA", "FRA"]);

  assert.throws(
    () => createCountry({ name: "Spain Duplicate", iso2Code: " es ", iso3Code: "USA" }),
    (error: any) => error?.code === "country_already_exists" && /Spain already exists for ISO2 ES/i.test(error.message)
  );

  assert.throws(
    () => createCountry({ name: "United States", iso2Code: "US", iso3Code: " gbr " }),
    (error: any) => error?.code === "country_already_exists" && /England already exists/i.test(error.message)
  );

  assert.throws(() => createCountry({ name: "Placeholder", iso2Code: "XX", iso3Code: "XXX" }), (error: any) => error?.code === "country_iso2_reserved");
  assert.throws(() => createCountry({ name: "Bad ISO2", iso2Code: "X", iso3Code: "BAD" }), (error: any) => error?.code === "country_iso2_invalid");
  assert.throws(() => createCountry({ name: "Bad ISO3", iso2Code: "ZZ", iso3Code: "BAD1" }), (error: any) => error?.code === "country_iso3_invalid");

  assert.throws(
    () => createCountry({ name: "England Duplicate", iso2Code: "US", iso3Code: " gbr " }),
    (error: any) => error?.code === "country_already_exists" && /England already exists for ISO3 GBR/i.test(error.message)
  );

  assert.equal(deleteCountry(countries[4]!.id), true);
  assert.equal(listCountries().length, 4);

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
