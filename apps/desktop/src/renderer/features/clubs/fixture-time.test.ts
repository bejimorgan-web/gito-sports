import assert from "node:assert/strict";
import test from "node:test";

import { formatFixtureDateTime, localDateTimeToUtc, parseOperatorKickoff } from "./fixture-time";

test("converts native local date and time to an explicit UTC instant", () => {
  const parsed = parseOperatorKickoff("23/08/2026 21:30");
  assert.deepEqual(parsed, { date: "2026-08-23", time: "21:30" });
  const value = localDateTimeToUtc(parsed!.date, parsed!.time, "Europe/Paris");
  assert.match(value ?? "", /Z$/);
  assert.equal(value, "2026-08-23T19:30:00.000Z");
});

test("rejects incomplete date/time and formats canonical timestamps", () => {
  assert.equal(parseOperatorKickoff("23/08/2026"), undefined);
  assert.equal(parseOperatorKickoff("23/08/2026 99:99"), undefined);
  assert.equal(parseOperatorKickoff("2026-08-23T21:30:00"), undefined);
  assert.equal(localDateTimeToUtc("", "20:30"), undefined);
  assert.equal(localDateTimeToUtc("2026-08-21", ""), undefined);
  assert.notEqual(formatFixtureDateTime("2026-08-21T18:30:00Z"), "Invalid kickoff");
  assert.equal(formatFixtureDateTime("not-a-date"), "Invalid kickoff");
});

test("honors winter and summer Paris offsets", () => {
  const winter = parseOperatorKickoff("23/01/2026 21:30")!;
  const summer = parseOperatorKickoff("23/08/2026 21:30")!;
  assert.equal(localDateTimeToUtc(winter.date, winter.time, "Europe/Paris"), "2026-01-23T20:30:00.000Z");
  assert.equal(localDateTimeToUtc(summer.date, summer.time, "Europe/Paris"), "2026-08-23T19:30:00.000Z");
});
