import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:gito_live_sports_mobile/main.dart';
import 'package:gito_live_sports_mobile/models/mobile_models.dart';
import 'package:gito_live_sports_mobile/screens/mobile_catalog_screens.dart';
import 'package:gito_live_sports_mobile/services/mobile_api_service.dart';

void main() {
  testWidgets('App starts and shows app title', (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.text('GiTO Live Sports'), findsOneWidget);
  });

  testWidgets('Personalize flow is reachable and shows sports selection',
      (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.byTooltip('Personalize GiTO'), findsOneWidget);
    await tester.pumpWidget(
      MaterialApp(
        home: const GitoPersonalizeScreen(api: _CatalogApi()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Personalize GiTO'), findsOneWidget);
    expect(find.text('What sports do you follow?'), findsOneWidget);
    expect(find.text('Soccer'), findsOneWidget);
  });

  testWidgets('Following screen surfaces selected sports and teams',
      (WidgetTester tester) async {
    final pref = await TestSharedPreferences.setUp();
    await pref
        .setStringList('gito_followed_sports', ['football', 'basketball']);
    await pref.setStringList('gito_followed_teams', ['barcelona', 'man-city']);

    await tester.pumpWidget(const GitoLiveSportsApp());
    await tester.tap(find.byTooltip('Following'));
    await tester.pumpAndSettle();

    expect(find.text('Following'), findsOneWidget);
    expect(find.text('Football'), findsOneWidget);
    expect(find.text('Barcelona'), findsOneWidget);
  });

  testWidgets(
      'Personalize flow filters hosts, competitions, and clubs by hierarchy',
      (WidgetTester tester) async {
    await TestSharedPreferences.setUp();
    await tester.pumpWidget(
      MaterialApp(home: GitoPersonalizeScreen(api: _CatalogApi())),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Soccer'));
    await tester.pump();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('Spain'), findsOneWidget);
    expect(find.text('England'), findsNothing);

    await tester.tap(find.text('Spain'));
    await tester.pump();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('League One'), findsOneWidget);
    expect(find.text('Other League'), findsNothing);

    await tester.tap(find.text('League One'));
    await tester.pump();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('Example Fc'), findsOneWidget);
    expect(find.text('Second Fc'), findsOneWidget);
    expect(find.text('Unrelated Fc'), findsNothing);

    await tester.tap(find.text('Example Fc'));
    await tester.tap(find.text('Second Fc'));
    await tester.tap(find.text('Done').last);
    await tester.pumpAndSettle();

    final followedTeams = await GitoFollowStore.readTeams();
    expect(followedTeams, containsAll(<String>['example fc', 'second fc']));
  });

  testWidgets(
      'Sports screen shows sport host navigation instead of a direct fixture list',
      (WidgetTester tester) async {
    await tester
        .pumpWidget(MaterialApp(home: SportsScreen(api: _CatalogApi())));
    await tester.pumpAndSettle();

    expect(find.text('Soccer'), findsOneWidget);
    await tester.tap(find.text('Soccer'));
    await tester.pumpAndSettle();

    expect(find.text('Spain'), findsOneWidget);
    await tester.tap(find.text('Spain'));
    await tester.pumpAndSettle();

    expect(find.text('League One'), findsOneWidget);
    await tester.tap(find.text('League One'));
    await tester.pumpAndSettle();

    expect(find.text('2026/27'), findsOneWidget);
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Upcoming'), findsOneWidget);
    expect(find.text('Results'), findsOneWidget);
    expect(find.text('Table'), findsOneWidget);
    expect(find.text('Teams'), findsOneWidget);
    expect(find.text('Stats'), findsOneWidget);
    expect(find.byKey(const ValueKey('competition-identity')), findsOneWidget);
    expect(find.byKey(const ValueKey('host-identity')), findsOneWidget);
    expect(find.byKey(const ValueKey('competition-season')), findsOneWidget);
    final competitionIdentity = tester.getCenter(
      find.byKey(const ValueKey('competition-identity')),
    );
    final hostIdentity = tester.getCenter(
      find.byKey(const ValueKey('host-identity')),
    );
    final seasonSelector = tester.getCenter(
      find.byKey(const ValueKey('competition-season')),
    );
    expect(competitionIdentity.dx, lessThan(hostIdentity.dx));
    expect(seasonSelector.dy, greaterThan(competitionIdentity.dy));
    expect(seasonSelector.dy, greaterThan(hostIdentity.dy));
  });

  testWidgets('Club page exposes the four requested sections',
      (WidgetTester tester) async {
    await TestSharedPreferences.setUp();
    await tester.pumpWidget(MaterialApp(
      home: ClubDetailScreen(clubId: 'team-1', api: _CatalogApi()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Example FC'), findsWidgets);
    expect(find.text('Soccer'), findsOneWidget);
    expect(find.text('Follow'), findsOneWidget);
    expect(find.text('News'), findsOneWidget);
    expect(find.text('Fixtures'), findsOneWidget);
    expect(find.text('Competitions'), findsOneWidget);
    expect(find.text('Squad'), findsOneWidget);
    expect(find.text('Live'), findsNothing);
    expect(find.text('Results'), findsNothing);
    expect(find.text('Stats'), findsNothing);

    await tester.tap(find.text('Competitions'));
    await tester.pumpAndSettle();
    expect(find.text('League One'), findsWidgets);
    expect(find.text('2026/27'), findsOneWidget);
    expect(find.text('Standings unavailable for this competition.'),
        findsOneWidget);

    await tester.tap(find.text('Fixtures'));
    await tester.pumpAndSettle();
    expect(find.text('Competition'), findsOneWidget);
    expect(find.text('All Competitions'), findsOneWidget);

    await tester.tap(find.text('Squad'));
    await tester.pumpAndSettle();
    expect(find.text('Squad data is not available yet.'), findsOneWidget);

    await tester.tap(find.text('Follow'));
    await tester.pumpAndSettle();
    expect(await GitoFollowStore.readTeams(), contains('example fc'));
  });

  testWidgets('Clubs list displays the canonical host and sport subtitle',
      (WidgetTester tester) async {
    await TestSharedPreferences.setUp();
    await tester.pumpWidget(MaterialApp(home: ClubsScreen(api: _CatalogApi())));
    await tester.pumpAndSettle();

    expect(find.text('Example FC'), findsOneWidget);
    expect(find.text('Spain - Soccer'), findsOneWidget);
    expect(find.textContaining('Unknown country'), findsNothing);
    expect(find.textContaining('Host unavailable'), findsNothing);
  });
}

class _CatalogApi extends MobileApiService {
  const _CatalogApi();

  @override
  Future<List<MobileSport>> getSports() async => const [
        MobileSport(id: 'sport-1', name: 'Soccer', slug: 'soccer'),
      ];

  @override
  Future<List<MobileHost>> getHosts({required String sportId}) async => const [
        MobileHost(
          id: 'host-1',
          sportId: 'sport-1',
          name: 'Spain',
          logoUrl: 'https://example.com/host.png',
        ),
        MobileHost(id: 'host-2', sportId: 'sport-2', name: 'England'),
      ];

  @override
  Future<List<MobileCompetition>> getCompetitions(
          {String? sportId, String? hostId}) async =>
      const [
        MobileCompetition(
          id: 'competition-1',
          name: 'League One',
          sportId: 'sport-1',
          hostId: 'host-1',
          logoUrl: 'https://example.com/competition.png',
        ),
        MobileCompetition(
          id: 'competition-2',
          name: 'Other League',
          sportId: 'sport-1',
          hostId: 'host-2',
        ),
      ];

  @override
  Future<List<MobileClub>> getClubs(
          {List<String> teamIds = const <String>[]}) async =>
      const [
        MobileClub(
            id: 'team-1',
            name: 'Example FC',
            sportId: 'sport-1',
            status: 'active'),
      ];

  @override
  Future<List<MobileSeason>> getCompetitionSeasons(
          String competitionId) async =>
      [
        MobileSeason(
          id: competitionId == 'competition-1' ? 'season-1' : 'season-2',
          competitionId: competitionId,
          name: '2026/27',
          status: 'active',
        ),
      ];

  @override
  Future<List<MobileFixture>> getSeasonFixtures(String seasonId) async =>
      const [];

  @override
  Future<List<MobileClub>> getSeasonTeams(String seasonId) async =>
      seasonId == 'season-1'
          ? const [
              MobileClub(
                id: 'team-1',
                name: 'Example FC',
                sportId: 'sport-1',
                status: 'active',
              ),
              MobileClub(
                id: 'team-2',
                name: 'Second FC',
                sportId: 'sport-1',
                status: 'active',
              ),
            ]
          : const [
              MobileClub(
                id: 'team-3',
                name: 'Unrelated FC',
                sportId: 'sport-2',
                status: 'active',
              ),
            ];

  @override
  Future<MobileClubDetail> getClub(String clubId) async =>
      const MobileClubDetail(
        club: MobileClub(
          id: 'team-1',
          name: 'Example FC',
          sportId: 'sport-1',
          status: 'active',
          sport: MobileSport(
            id: 'sport-1',
            name: 'Soccer',
            logoUrl: 'https://example.com/sport.png',
          ),
          country: MobileCountry(id: 'country-1', name: 'Spain'),
        ),
        competitions: [
          MobileCompetition(
            id: 'competition-1',
            name: 'League One',
            sportId: 'sport-1',
            hostId: 'host-1',
          ),
        ],
        seasons: [
          MobileSeason(
            id: 'season-1',
            competitionId: 'competition-1',
            name: '2026/27',
            status: 'active',
          ),
        ],
      );

  @override
  Future<List<MobileNewsArticle>> getClubNews(String clubId) async => const [];

  @override
  Future<List<MobileFixture>> getClubFixtures(String clubId) async => const [
        MobileFixture(
          id: 'fixture-1',
          startsAt: null,
          status: 'scheduled',
          competition: MobileCompetition(
            id: 'competition-1',
            name: 'League One',
            sportId: 'sport-1',
          ),
          season: MobileSeason(
            id: 'season-1',
            competitionId: 'competition-1',
            name: '2026/27',
            status: 'active',
          ),
          homeClub: MobileClub(
            id: 'team-1',
            name: 'Example FC',
            sportId: 'sport-1',
            status: 'active',
          ),
          awayClub: MobileClub(
            id: 'team-2',
            name: 'Second FC',
            sportId: 'sport-1',
            status: 'active',
          ),
          live: false,
          streams: const [],
        ),
      ];
}

class TestSharedPreferences {
  static Future<SharedPreferences> setUp() async {
    SharedPreferences.setMockInitialValues({});
    return SharedPreferences.getInstance();
  }
}
