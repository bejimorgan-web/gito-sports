import assert from "node:assert/strict";
import test from "node:test";

import { resolveCountryName } from "./country-catalog";

test("resolves common countries to canonical ISO codes", () => {
  assert.deepEqual(resolveCountryName("Spain"), { name: "Spain", iso2Code: "ES", iso3Code: "ESP" });
  assert.deepEqual(resolveCountryName("England"), { name: "England", iso2Code: "GB", iso3Code: "GBR" });
  assert.deepEqual(resolveCountryName("Germany"), { name: "Germany", iso2Code: "DE", iso3Code: "DEU" });
  assert.deepEqual(resolveCountryName("Italy"), { name: "Italy", iso2Code: "IT", iso3Code: "ITA" });
  assert.deepEqual(resolveCountryName("France"), { name: "France", iso2Code: "FR", iso3Code: "FRA" });
});

test("rejects unknown and non-country names without placeholder codes", () => {
  assert.equal(resolveCountryName("Atlantis"), undefined);
  assert.equal(resolveCountryName("FIFA"), undefined);
  assert.equal(resolveCountryName(""), undefined);
});
