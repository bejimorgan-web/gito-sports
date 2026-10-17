import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { encodeCsv, normalizeCsvName, parseCsvFile } from "./csv-files.js";

test("CSV roster export round-trips quoted, comma-separated, and multiline fields", async () => {
  const csv = encodeCsv(["team_name", "logo_url", "home_stadium_name"], [{
    team_name: 'North, "United"', logo_url: "", home_stadium_name: "North Ground\nMain Stand"
  }]);
  const rows = await parseCsvFile(new File([csv], "teams.csv"));
  assert.deepEqual(rows, [{ team_name: 'North, "United"', logo_url: "", home_stadium_name: "North Ground\nMain Stand" }]);
  assert.equal(normalizeCsvName("  ＮＯＲＴＨ United "), "north united");
});

test("CSV import rejects malformed quotes, inconsistent rows, and duplicate headers", async () => {
  await assert.rejects(parseCsvFile(new File(["team_name,logo_url\n\"North"], "broken.csv")), /unterminated quoted field/);
  await assert.rejects(parseCsvFile(new File(["team_name,logo_url\nNorth"], "short.csv")), /expected 2/);
  await assert.rejects(parseCsvFile(new File(["team_name,team_name\nNorth,North"], "duplicate.csv")), /duplicate column/);
});
