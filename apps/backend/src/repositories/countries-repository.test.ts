import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-countries-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { createCountry, listCountries } = await import("./countries-repository.js");

function seedCountry() {
  return createCountry({ name: "United Kingdom", iso2Code: "GB", iso3Code: "GBR" });
}

test("country creation normalizes and rejects duplicate ISO2/ISO3 codes", () => {
  seedCountry();

  assert.throws(
    () => createCountry({ name: "United Kingdom Duplicate", iso2Code: " gb ", iso3Code: "USA" }),
    (error: any) => error?.code === "country_already_exists" && /United Kingdom already exists/i.test(error.message)
  );

  assert.throws(
    () => createCountry({ name: "United States", iso2Code: "US", iso3Code: " gbr " }),
    (error: any) => error?.code === "country_already_exists" && /United Kingdom already exists/i.test(error.message)
  );

  assert.equal(listCountries().length, 1);
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
