import assert from "node:assert/strict";
import test from "node:test";

import { formatFixtureDateTime, localDateTimeToUtc, utcToOperatorKickoff } from "./fixture-time";

test("converts the native Match Control datetime-local value", () => {
  assert.equal(localDateTimeToUtc("2026-08-23T21:30"), "2026-08-23T19:30:00.000Z");
});

test("rejects incomplete date/time and formats canonical timestamps", () => {
  assert.equal(localDateTimeToUtc(""), undefined);
  assert.equal(localDateTimeToUtc("not-a-date"), undefined);
  assert.notEqual(formatFixtureDateTime("2026-08-21T18:30:00Z"), "Invalid kickoff");
  assert.equal(formatFixtureDateTime("not-a-date"), "Invalid kickoff");
  assert.equal(utcToOperatorKickoff("2026-08-23T19:30:00.000Z"), "2026-08-23T21:30");
});

test("honors winter and summer Paris offsets", () => {
  assert.equal(localDateTimeToUtc("2026-01-23T21:30"), "2026-01-23T20:30:00.000Z");
  assert.equal(localDateTimeToUtc("2026-08-23T21:30"), "2026-08-23T19:30:00.000Z");
});
