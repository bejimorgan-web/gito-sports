# Phase 1 Cold Start Validation Report
Generated: 2026-05-30T14:25:08Z

## Startup Result
- Health endpoint returned status: ok
- Service name: gito-backend
- Database status: ok
- Health timestamp: 2026-05-30T14:25:08.835Z
- Backend started cleanly with no visible migration errors.

## API Result
- GET /sports returned 6 entries
- GET /countries returned 2 entries
- GET /competitions returned 6 entries
- GET /teams returned 10 entries

## Previous Phase 1 Data Verification
- Previous sport id fd117dfa-ec35-4c5a-9330-333f96a5c4f3 present in GET /sports: True
- Previous country id 48fdad7f-a711-4579-8196-938712588712 present in GET /countrys: True
- Previous competition id 814935e1-fbf6-4c2c-844d-bc04dc7df04f present in GET /competitions: True
- Previous team id 294d8adc-163b-4c09-a40d-ecd73b32d3c1 present in GET /teams: True

## CRUD Result
- Created sport ColdTestSport 20260530142508 id a25588bc-b7f9-42f1-a6a5-4c100bbbaa64
- Created country ColdTestCountry 20260530142508 id 53fcc2a3-44f4-4305-8f2b-1683c9e4d884
- Created competition ColdTestCompetition 20260530142508 id b38d68c1-6775-47cf-bd76-d6604169ca27
- Created team ColdTestTeam 20260530142508 id 3cd6d6c2-5cb1-42a4-8bae-ae383c9b5dcb
- Verified created cold-start sport exists in /sports: True
- Verified created cold-start country exists in /countries: True
- Verified created cold-start competition exists in /competitions: True
- Verified created cold-start team exists in /teams: True

## IPTV Regression Result
- GET /iptv/providers returned 6 providers
- IPTV endpoint responded successfully and did not degrade

## DB Integrity Result
- Backend SQLite path: apps\backend\data\gito.sqlite
- Found 14 tables, 14 unique table names
- SQLite integrity_check: ok
- SQLite foreign_key_check entries: 0
- sports row ColdTestSport 20260530142508 timestamps valid: created_at=2026-05-30T14:25:08.916Z, updated_at=2026-05-30T14:25:08.916Z
- countries row ColdTestCountry 20260530142508 timestamps valid: created_at=2026-05-30T14:25:09.109Z, updated_at=2026-05-30T14:25:09.109Z
- competitions row ColdTestCompetition 20260530142508 timestamps valid: created_at=2026-05-30T14:25:09.432Z, updated_at=2026-05-30T14:25:09.432Z
- teams row ColdTestTeam 20260530142508 timestamps valid: created_at=2026-05-30T14:25:09.931Z, updated_at=2026-05-30T14:25:09.931Z
- Previous sports id fd117dfa-ec35-4c5a-9330-333f96a5c4f3 present in SQLite: True
- Previous countries id 48fdad7f-a711-4579-8196-938712588712 present in SQLite: True
- Previous competitions id 814935e1-fbf6-4c2c-844d-bc04dc7df04f present in SQLite: True
- Previous teams id 294d8adc-163b-4c09-a40d-ecd73b32d3c1 present in SQLite: True

## Final Verdict
- PASS
