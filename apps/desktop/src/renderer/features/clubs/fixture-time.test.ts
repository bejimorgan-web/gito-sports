import assert from "node:assert/strict";
import test from "node:test";

import { formatFixtureDateTime, localDateTimeToUtc } from "./fixture-time";

test("converts native local date and time to an explicit UTC instant", () => {
  const value = localDateTimeToUtc("2026-08-21", "20:30");
  assert.match(value ?? "", /Z$/);
  assert.equal(new Date(value ?? "").getTime(), new Date("2026-08-21T20:30:00").getTime());
});

test("rejects incomplete date/time and formats canonical timestamps", () => {
  assert.equal(localDateTimeToUtc("", "20:30"), undefined);
  assert.equal(localDateTimeToUtc("2026-08-21", ""), undefined);
  assert.notEqual(formatFixtureDateTime("2026-08-21T18:30:00Z"), "Invalid kickoff");
  assert.equal(formatFixtureDateTime("not-a-date"), "Invalid kickoff");
});
