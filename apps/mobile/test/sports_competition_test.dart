import 'package:flutter_test/flutter_test.dart';
import 'package:gito_live_sports_mobile/main.dart';
import 'package:gito_live_sports_mobile/models/mobile_models.dart';

MobileFixture _fixture({
  required String id,
  required String startsAt,
  required String status,
}) {
  const sport = MobileSport(id: 'sport-1', name: 'Soccer');
  const competition = MobileCompetition(
    id: 'competition-1',
    name: 'League One',
    sportId: 'sport-1',
  );
  const home = MobileClub(
    id: 'home-1',
    name: 'Home FC',
    sportId: 'sport-1',
    status: 'active',
  );
  const away = MobileClub(
    id: 'away-1',
    name: 'Away FC',
    sportId: 'sport-1',
    status: 'active',
  );
  return MobileFixture(
    id: id,
    startsAt: DateTime.parse(startsAt),
    status: status,
    competition: competition,
    season: MobileSeason(
      id: 'season-1',
      competitionId: 'competition-1',
      name: '2026/27',
      status: 'active',
    ),
    sport: sport,
    homeClub: home,
    awayClub: away,
    live: false,
    streams: const [],
  );
}

void main() {
  final now = DateTime.utc(2026, 9, 18, 12);
  final fixtures = [
    _fixture(
      id: 'today',
      startsAt: '2026-09-18T15:00:00Z',
      status: 'scheduled',
    ),
    _fixture(
      id: 'upcoming',
      startsAt: '2026-09-20T15:00:00Z',
      status: 'scheduled',
    ),
    _fixture(
      id: 'result',
      startsAt: '2026-09-17T15:00:00Z',
      status: 'ended',
    ),
  ];

  test('competition sections are filtered from one season fixture dataset', () {
    expect(
      competitionFixturesForSection(
        fixtures,
        CompetitionSection.today,
        now: now,
      ).map((fixture) => fixture.id),
      ['today'],
    );
    expect(
      competitionFixturesForSection(
        fixtures,
        CompetitionSection.upcoming,
        now: now,
      ).map((fixture) => fixture.id),
      ['upcoming'],
    );
    expect(
      competitionFixturesForSection(
        fixtures,
        CompetitionSection.results,
        now: now,
      ).map((fixture) => fixture.id),
      ['result'],
    );
  });

  test('season selection remains competition-scoped', () {
    final season = MobileSeason.fromJson({
      'id': 'season-2026',
      'competitionId': 'competition-1',
      'name': '2026/27',
      'status': 'active',
    });

    expect(season.competitionId, 'competition-1');
    expect(season.name, '2026/27');
  });
}
