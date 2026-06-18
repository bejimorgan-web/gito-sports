# Deletion Architecture Proposal

## Executive Summary

The current deletion implementation blocks deletion of master entities (Sports, Countries, Competitions, Teams) when related records exist. This proposal enables operators to delete any entity without being blocked by relationship records, while maintaining referential integrity and preserving data consistency.

**Core Principle**: Relationship/join table records are automatically removed; match-level data (schedules, streams, published records) is cascade-deleted as allowed.

---

## Current Dependency Map

### Entity Relationships

```
Sports
├── sport_countries (junction) → Countries
│   - ON DELETE CASCADE (sport_id)
│   - No constraint on country_id
├── Competitions
│   - NO ON DELETE CASCADE
│   - Blocks sport deletion if competitions exist
├── Teams
│   - NO ON DELETE CASCADE
│   - Blocks sport deletion indirectly (teams → competitions)
└── scheduling_matches
    - NO ON DELETE CASCADE
    - References sport_id directly

Countries
├── sport_countries (junction)
│   - No constraint on country_id
│   - Country deletion not blocked by this table
├── Competitions
│   - NO ON DELETE CASCADE
│   - Blocks country deletion if competitions reference it
├── Teams
│   - NO ON DELETE CASCADE
│   - Blocks country deletion if teams reference it
└── scheduling_matches
    - References country_id
    - Blocks country deletion

Competitions
├── competition_teams (junction) → Teams
│   - NO ON DELETE CASCADE
│   - Team records persist; junction deleted manually
├── Matches
│   - NO ON DELETE CASCADE
│   - Blocks competition deletion
├── Seasons
│   - Likely ON DELETE CASCADE (child records)
│   - Season deletion cascades to matches
└── scheduling_matches
    - NO ON DELETE CASCADE
    - Blocks competition deletion

Teams (Clubs / National Teams)
├── competition_teams (junction) → Competitions
│   - NO ON DELETE CASCADE
│   - Blocks team deletion if in competition_teams
├── Matches (home_team_id / away_team_id)
│   - NO ON DELETE CASCADE
│   - Blocks team deletion
├── scheduling_matches (home_team_id / away_team_id)
│   - NO ON DELETE CASCADE
│   - Blocks team deletion
└── Streams (via match_id)
    - Indirect reference
```

### Current Delete Validation Logic

| Entity | Current Behavior | Blocking Conditions |
|--------|------------------|-------------------|
| Sport | `deleteSport()` | `COUNT competitions WHERE sport_id = ?` > 0 |
| Country | `deleteCountry()` | `COUNT competitions WHERE country_id = ?` > 0 OR `COUNT teams WHERE country_id = ?` > 0 |
| Competition | `deleteCompetition()` | `COUNT matches WHERE competition_id = ?` > 0 |
| Team | `deleteTeam()` | `COUNT matches WHERE home_team_id = ? OR away_team_id = ?` > 0 |

---

## Proposed Relationship Model

### Deletion Cascade Strategy by Entity

#### 1. DELETE SPORT

**Goal**: Remove a sport and all its relationship links while preserving countries, competitions, clubs, national teams.

**Cascade Actions**:
- ✅ Delete `sport_countries` records (junction)
- ✅ Orphan `competitions` (set sport_id = NULL or keep with sport reference for audit)
- ✅ Orphan `teams` (set sport_id = NULL or keep with sport reference)
- ✅ Orphan `scheduling_matches` (set sport_id = NULL)
- ✅ Delete `streams` (via match cascade)
- ✅ Delete `matches` (via competition cascade)
- ✅ Delete `match_streams` (via scheduling_matches cascade)

**Impact**: Countries, competitions, clubs survive but lose sport association. Matches associated with sport competitions are cleaned up.

#### 2. DELETE COUNTRY

**Goal**: Remove country and all its relationship links while preserving competitions and clubs.

**Cascade Actions**:
- ✅ Delete `sport_countries` records (country_id)
- ✅ Orphan `competitions` (set country_id = NULL)
- ✅ Orphan `teams` (set country_id = NULL)
- ✅ Orphan `scheduling_matches` (set country_id = NULL)
- ✅ Delete `streams` (via match cascade)
- ✅ Delete `matches` (via competition cascade)
- ✅ Delete `match_streams` (via scheduling_matches cascade)

**Impact**: Competitions and clubs survive but lose country association. Matches are cleaned up.

#### 3. DELETE COMPETITION

**Goal**: Remove competition and all its relationship links while preserving clubs and national teams.

**Cascade Actions**:
- ✅ Delete `competition_teams` records (junction)
- ✅ Delete `seasons` (ON DELETE CASCADE)
- ✅ Delete `matches` (ON DELETE CASCADE or application-level)
- ✅ Delete `streams` (via match cascade)
- ✅ Delete `scheduling_matches` (ON DELETE CASCADE or application-level)
- ✅ Delete `match_streams` (via scheduling_matches cascade)

**Impact**: Teams survive but lose competition enrollment. Matches and streams are cleaned up.

#### 4. DELETE CLUB (Team of type 'club')

**Goal**: Remove club and all its relationship links while preserving competitions.

**Cascade Actions**:
- ✅ Delete `competition_teams` records (team_id)
- ✅ Delete `matches` where team is home or away (ON DELETE CASCADE or application-level)
- ✅ Delete `streams` (via match cascade)
- ✅ Delete `scheduling_matches` where team is home or away (ON DELETE CASCADE or application-level)
- ✅ Delete `match_streams` (via scheduling_matches cascade)

**Impact**: Competitions survive but lose club enrollment. Matches are cleaned up.

#### 5. DELETE NATIONAL TEAM (Team of type 'national')

**Goal**: Remove national team and all its relationship links while preserving competitions.

**Cascade Actions**:
- ✅ Delete `competition_teams` records (team_id)
- ✅ Delete `matches` where team is home or away (ON DELETE CASCADE or application-level)
- ✅ Delete `streams` (via match cascade)
- ✅ Delete `scheduling_matches` where team is home or away (ON DELETE CASCADE or application-level)
- ✅ Delete `match_streams` (via scheduling_matches cascade)

**Impact**: Competitions survive but lose team enrollment. Matches are cleaned up.

---

## SQL Migration Strategy

### Phase 1: Add Cascading Foreign Keys

#### 1.1 Update competitions → sports (WITH ORPHANING)

```sql
-- Remove old FK
PRAGMA foreign_keys = OFF;

-- Add new constraint with CASCADE
-- SQLite limitation: Use triggers for ON DELETE actions
CREATE TRIGGER competition_sport_delete
AFTER DELETE ON sports
FOR EACH ROW
BEGIN
  DELETE FROM competition_teams WHERE competition_id IN (
    SELECT id FROM competitions WHERE sport_id = OLD.id
  );
  DELETE FROM scheduling_matches WHERE competition_id IN (
    SELECT id FROM competitions WHERE sport_id = OLD.id
  );
  UPDATE competitions SET sport_id = NULL WHERE sport_id = OLD.id;
END;

PRAGMA foreign_keys = ON;
```

#### 1.2 Update competitions → countries (WITH ORPHANING)

```sql
CREATE TRIGGER competition_country_delete
AFTER DELETE ON countries
FOR EACH ROW
BEGIN
  DELETE FROM competition_teams WHERE competition_id IN (
    SELECT id FROM competitions WHERE country_id = OLD.id
  );
  DELETE FROM scheduling_matches WHERE competition_id IN (
    SELECT id FROM competitions WHERE country_id = OLD.id
  );
  UPDATE competitions SET country_id = NULL WHERE country_id = OLD.id;
END;
```

#### 1.3 Update sport_countries (FIX country_id constraint)

```sql
-- Recreate table with proper foreign key
CREATE TABLE sport_countries_new (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  country_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id) ON DELETE CASCADE,
  FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
);

INSERT INTO sport_countries_new SELECT * FROM sport_countries;
DROP TABLE sport_countries;
ALTER TABLE sport_countries_new RENAME TO sport_countries;

CREATE UNIQUE INDEX idx_sport_countries_sport_country 
  ON sport_countries(sport_id, country_id);
```

#### 1.4 Update teams → countries (WITH ORPHANING)

```sql
CREATE TRIGGER team_country_delete
AFTER DELETE ON countries
FOR EACH ROW
BEGIN
  DELETE FROM competition_teams WHERE team_id IN (
    SELECT id FROM teams WHERE country_id = OLD.id
  );
  DELETE FROM scheduling_matches WHERE home_team_id IN (
    SELECT id FROM teams WHERE country_id = OLD.id
  ) OR away_team_id IN (
    SELECT id FROM teams WHERE country_id = OLD.id
  );
  UPDATE teams SET country_id = NULL WHERE country_id = OLD.id;
END;
```

#### 1.5 Update teams → sports (WITH ORPHANING)

```sql
CREATE TRIGGER team_sport_delete
AFTER DELETE ON sports
FOR EACH ROW
BEGIN
  DELETE FROM competition_teams WHERE team_id IN (
    SELECT id FROM teams WHERE sport_id = OLD.id
  );
  DELETE FROM scheduling_matches WHERE home_team_id IN (
    SELECT id FROM teams WHERE sport_id = OLD.id
  ) OR away_team_id IN (
    SELECT id FROM teams WHERE sport_id = OLD.id
  );
  UPDATE teams SET sport_id = NULL WHERE sport_id = OLD.id;
END;
```

#### 1.6 Update competition_teams → competitions (CASCADE)

```sql
-- Recreate with proper cascade
CREATE TABLE competition_teams_new (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  UNIQUE (competition_id, team_id)
);

INSERT INTO competition_teams_new SELECT * FROM competition_teams;
DROP TABLE competition_teams;
ALTER TABLE competition_teams_new RENAME TO competition_teams;
```

#### 1.7 Update competition_teams → teams (CASCADE)

```sql
-- Recreate with proper cascade for both directions
CREATE TABLE competition_teams_new (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE (competition_id, team_id)
);

INSERT INTO competition_teams_new SELECT * FROM competition_teams;
DROP TABLE competition_teams;
ALTER TABLE competition_teams_new RENAME TO competition_teams;
```

#### 1.8 Update matches → teams (CASCADE)

```sql
-- Recreate matches with proper cascade
CREATE TABLE matches_new (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  season_id TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  venue_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CHECK (status IN ('draft', 'scheduled', 'assigned', 'approved', 'published', 'live', 'ended', 'cancelled'))
);

INSERT INTO matches_new SELECT * FROM matches;
DROP TABLE matches;
ALTER TABLE matches_new RENAME TO matches;

CREATE INDEX idx_matches_competition ON matches(competition_id);
CREATE INDEX idx_matches_teams ON matches(home_team_id, away_team_id);
CREATE INDEX idx_matches_season ON matches(season_id);
```

#### 1.9 Update streams → matches (CASCADE)

```sql
-- Recreate streams with cascade
CREATE TABLE streams_new (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'hls',
  status TEXT NOT NULL DEFAULT 'idle',
  approval_status TEXT NOT NULL DEFAULT 'idle',
  approved_by_user_id TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  published_at TEXT,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  health_reason TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_health_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  CHECK (status IN ('idle', 'assigned', 'testing', 'approved', 'active', 'failed', 'disabled')),
  CHECK (approval_status IN ('idle', 'assigned', 'testing', 'approved', 'active', 'failed', 'disabled')),
  CHECK (health_status IN ('active', 'degraded', 'failed', 'unknown'))
);

INSERT INTO streams_new SELECT * FROM streams;
DROP TABLE streams;
ALTER TABLE streams_new RENAME TO streams;
```

#### 1.10 Update scheduling_matches → competitions (CASCADE)

```sql
-- Recreate scheduling_matches with proper cascade
CREATE TABLE scheduling_matches_new (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  country_id TEXT,
  sport_id TEXT,
  kickoff_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE SET NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id) ON DELETE SET NULL,
  CHECK (status IN ('scheduled', 'live', 'ended'))
);

INSERT INTO scheduling_matches_new SELECT * FROM scheduling_matches;
DROP TABLE scheduling_matches;
ALTER TABLE scheduling_matches_new RENAME TO scheduling_matches;

CREATE INDEX idx_scheduling_matches_competition ON scheduling_matches(competition_id);
CREATE INDEX idx_scheduling_matches_teams ON scheduling_matches(home_team_id, away_team_id);
```

#### 1.11 Update match_streams → scheduling_matches (CASCADE)

```sql
-- Recreate match_streams with proper cascade
CREATE TABLE match_streams_new (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  stream_url TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES scheduling_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  UNIQUE (match_id, channel_id)
);

INSERT INTO match_streams_new SELECT * FROM match_streams;
DROP TABLE match_streams;
ALTER TABLE match_streams_new RENAME TO match_streams;
```

### Phase 2: Application-Level Delete Logic

Update repository delete functions to handle cascade logic:

```typescript
// sports-repository.ts
export function deleteSport(sportId: string): boolean {
  const database = getDatabase();
  
  return database.transaction(() => {
    // 1. Delete competition_teams for competitions under this sport
    database.prepare(`
      DELETE FROM competition_teams 
      WHERE competition_id IN (
        SELECT id FROM competitions WHERE sport_id = ?
      )
    `).run(sportId);
    
    // 2. Delete scheduling_matches for this sport
    database.prepare(`
      DELETE FROM scheduling_matches 
      WHERE sport_id = ?
    `).run(sportId);
    
    // 3. Orphan competitions (keep for audit trail)
    database.prepare(`
      UPDATE competitions 
      SET sport_id = NULL 
      WHERE sport_id = ?
    `).run(sportId);
    
    // 4. Orphan teams
    database.prepare(`
      UPDATE teams 
      SET sport_id = NULL 
      WHERE sport_id = ?
    `).run(sportId);
    
    // 5. Delete sport_countries (will auto-cascade via FK)
    // (handled by trigger or CASCADE)
    
    // 6. Delete the sport itself
    const result = database.prepare(`
      DELETE FROM sports WHERE id = ?
    `).run(sportId);
    
    return result.changes > 0;
  })();
}
```

---

## Foreign Key Strategy

### Summary of Foreign Key Changes

| Table | Column | Current | Proposed | Behavior |
|-------|--------|---------|----------|----------|
| sport_countries | sport_id | CASCADE | CASCADE | Delete junction when sport deleted |
| sport_countries | country_id | NO FK | CASCADE | Delete junction when country deleted |
| competitions | sport_id | NO CASCADE | TRIGGER + UPDATE | Orphan competition, clean matches |
| competitions | country_id | NO CASCADE | TRIGGER + UPDATE | Orphan competition, clean matches |
| competitions | region_id | None | (keep) | No deletion needed |
| teams | sport_id | NO CASCADE | TRIGGER + UPDATE | Orphan team, clean enrollments |
| teams | country_id | NO CASCADE | TRIGGER + UPDATE | Orphan team, clean enrollments |
| competition_teams | competition_id | NO CASCADE | CASCADE | Delete junction when competition deleted |
| competition_teams | team_id | NO CASCADE | CASCADE | Delete junction when team deleted |
| matches | competition_id | NO CASCADE | CASCADE | Delete matches when competition deleted |
| matches | home_team_id | NO CASCADE | CASCADE | Delete match when team deleted |
| matches | away_team_id | NO CASCADE | CASCADE | Delete match when team deleted |
| streams | match_id | NO CASCADE | CASCADE | Delete stream when match deleted |
| scheduling_matches | competition_id | NO CASCADE | CASCADE | Delete match when competition deleted |
| scheduling_matches | home_team_id | NO CASCADE | CASCADE | Delete match when team deleted |
| scheduling_matches | away_team_id | NO CASCADE | CASCADE | Delete match when team deleted |
| scheduling_matches | country_id | None | SET NULL | Orphan match, keep for records |
| scheduling_matches | sport_id | None | SET NULL | Orphan match, keep for records |
| match_streams | match_id | None | CASCADE | Delete stream assignment when match deleted |

### Cascade Rules Summary

**DELETE CASCADE** (delete dependent records):
- sport_countries ← sports
- competition_teams ← competitions
- competition_teams ← teams
- matches ← competitions
- matches ← teams (both home/away)
- streams ← matches
- scheduling_matches ← competitions
- scheduling_matches ← teams (both home/away)
- match_streams ← scheduling_matches
- seasons ← competitions (likely already CASCADE)

**UPDATE to NULL / ORPHAN** (via triggers):
- competitions.sport_id ← sports (triggered orphaning)
- competitions.country_id ← countries (triggered orphaning)
- teams.sport_id ← sports (triggered orphaning)
- teams.country_id ← countries (triggered orphaning)
- scheduling_matches.sport_id ← sports (SET NULL)
- scheduling_matches.country_id ← countries (SET NULL)

---

## Operator Workflow

### Delete Sport Workflow

1. Operator navigates to Sports Management
2. Selects a sport for deletion
3. System shows impact preview:
   - Number of competitions to be orphaned
   - Number of teams to be orphaned
   - Number of matches to be deleted
   - Number of streams to be deleted
4. Operator confirms deletion
5. System executes deletion transaction:
   - Remove sport_countries links
   - Remove competition_teams links
   - Remove matches and cascaded streams
   - Orphan competitions and teams
   - Delete the sport record
6. Operational log created with deletion details

### Delete Country Workflow

1. Operator navigates to Countries Management
2. Selects a country for deletion
3. System shows impact preview:
   - Number of competitions to be orphaned
   - Number of teams to be orphaned
   - Number of matches to be deleted
   - Number of streams to be deleted
4. Operator confirms deletion
5. System executes deletion transaction:
   - Remove sport_countries links
   - Remove competition_teams links (where team.country_id = country)
   - Remove matches and cascaded streams (where team.country_id = country)
   - Orphan competitions and teams
   - Delete the country record
6. Operational log created with deletion details

### Delete Competition Workflow

1. Operator navigates to Competition Management (under a sport)
2. Selects a competition for deletion
3. System shows impact preview:
   - Number of teams to be removed from competition
   - Number of matches to be deleted
   - Number of streams to be deleted
   - Number of seasons to be deleted
4. Operator confirms deletion
5. System executes deletion transaction:
   - Remove competition_teams links (keep teams)
   - Remove scheduling_matches
   - Remove matches and cascaded streams
   - Delete seasons
   - Delete the competition record
6. Operational log created with deletion details

### Delete Club/National Team Workflow

1. Operator navigates to Team Management (under a sport)
2. Selects a team for deletion
3. System shows impact preview:
   - Number of competitions team will be removed from
   - Number of matches where team is participant
   - Number of streams to be deleted
   - Number of scheduling matches to be deleted
4. Operator confirms deletion
5. System executes deletion transaction:
   - Remove competition_teams links (keep competitions)
   - Remove matches where team is home or away
   - Remove scheduling_matches where team is home or away
   - Remove cascaded streams
   - Delete the team record
6. Operational log created with deletion details

---

## Impact Analysis

### Data Preservation

| Entity | Delete | Preserved After | Notes |
|--------|--------|-----------------|-------|
| Sport | Sport record + sport_countries | Countries, competitions, teams (orphaned) | Competitions/teams lose sport context |
| Country | Country record + sport_countries | Competitions, teams (orphaned), sports | Competitions/teams lose country context |
| Competition | Competition + competition_teams + seasons | Teams (no longer enrolled), sports, countries | Teams remain available for other competitions |
| Team | Team record + competition_teams | Competitions (no longer have team), sports, countries | Competitions remain but lose team enrollment |
| Match | Match record + streams | Teams, competitions, countries, sports | No data loss at higher levels |

### Operational Logs

Each deletion should create operational log entries:

```json
{
  "event_type": "entity_deleted",
  "entity_type": "sport",
  "entity_id": "<sport_id>",
  "severity": "warning",
  "message": "Sport 'Soccer' deleted by Operator Name",
  "metadata": {
    "sport_name": "Soccer",
    "deleted_by": "<operator_id>",
    "cascaded_deletions": {
      "matches": 45,
      "streams": 127,
      "competition_teams": 8
    },
    "orphaned_entities": {
      "competitions": 2,
      "teams": 12
    }
  }
}
```

---

## Implementation Checklist

- [ ] Phase 1: Create SQL migration file with all trigger and FK changes
- [ ] Phase 1: Test migration on copy of production database
- [ ] Phase 2: Update `sports-repository.ts` delete function
- [ ] Phase 2: Update `countries-repository.ts` delete function
- [ ] Phase 2: Update `competitions-repository.ts` delete function
- [ ] Phase 2: Update `teams-repository.ts` delete function
- [ ] Phase 2: Add transaction wrappers to delete functions
- [ ] Phase 3: Update API route handlers to return impact preview before deletion
- [ ] Phase 3: Add operational logging for all deletions
- [ ] Phase 4: Update frontend UI to show deletion confirmation with impact details
- [ ] Phase 5: End-to-end testing with test data
- [ ] Phase 6: Operator training and documentation
- [ ] Phase 7: Production deployment with backup

---

## Risk Mitigation

### Pre-Deletion Checks

1. **Impact Preview**: Show operator exact counts of what will be deleted/orphaned
2. **Confirmation Dialog**: Require explicit operator confirmation with typed entity name
3. **Operational Logging**: Log all deletions with metadata for audit trail
4. **Backups**: Ensure production backup taken before deletion operations

### Rollback Strategy

If deletion causes issues:

1. Restore from pre-deletion backup
2. Manually re-link orphaned records using entity ID mappings
3. Update affected matches with correct team references

### Testing Strategy

1. Create test database with sample data
2. Test each deletion scenario with various dependent data
3. Verify cascades work as expected
4. Verify orphaning updates data correctly
5. Verify operational logs created properly
6. Run full regression test on sports/countries/competitions/teams workflows

---

## Conclusion

This architecture enables operators to delete master entities without being blocked by relationships while maintaining data integrity. The key principles are:

1. **Master entity relationship records** (sport_countries, competition_teams) → DELETE CASCADE
2. **Match-level data** (matches, streams, scheduling_matches) → DELETE CASCADE
3. **Foreign entity references** (competitions.sport_id, teams.country_id) → ORPHAN (SET NULL or UPDATE to NULL via trigger)
4. **Audit trail** → Operational logging of all deletions with impact counts

This approach balances operator flexibility with data safety and audit requirements.
