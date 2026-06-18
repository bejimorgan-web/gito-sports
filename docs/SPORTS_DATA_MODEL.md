# Sports Data Model

The sports model must support multiple sports while focusing first on football.

## Principles

- A sport owns competitions, teams, and match rules.
- Competitions are not strictly tied to countries.
- Teams can represent clubs, national teams, or custom participants.
- Competition scope communicates context without limiting structure.

## Competition Scopes

- Domestic: country-level leagues and cups.
- Continental: competitions spanning a continent or region.
- International: national-team tournaments or global club events.
- Friendly: exhibition or non-table events.
- Custom: operator-defined competition structures.

## Football MVP Entities

- Sport: Football.
- Competitions: domestic leagues, domestic cups, continental tournaments, international tournaments.
- Teams: clubs and national teams.
- Matches: scheduled fixtures with home and away sides.

## Future Sports

The model should later support sports with:

- non-team participants
- tournament brackets
- groups and standings
- multi-stage competitions
- different scoring models

