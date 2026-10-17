import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gito_live_sports_mobile/main.dart';
import 'package:gito_live_sports_mobile/models/mobile_models.dart';
import 'package:gito_live_sports_mobile/screens/mobile_standings_section.dart';
import 'package:gito_live_sports_mobile/services/mobile_api_service.dart';

Map<String, dynamic> _standingsJson({
  String competitionId = 'competition-1',
  String competitionName = 'League One',
  String seasonId = 'season-1',
  String seasonName = '2026/27',
  String status = 'eligible',
  String? explanation,
  String coverageStatus = 'verified_complete',
  List<Map<String, dynamic>>? rows,
}) =>
    {
      'competition': {'id': competitionId, 'name': competitionName},
      'season': {'id': seasonId, 'name': seasonName},
      'snapshot': {
        'id': 'snapshot-1',
        'sequence': 4,
        'calculatedAt': '2026-10-01T12:00:00.000Z',
        'ruleset': {'id': 'league-rules', 'version': 2},
      },
      'status': status,
      'explanation': explanation,
      'rows': rows ??
          [
            {
              'rank': 1,
              'team': {'id': 'team-a', 'name': 'Alpha FC'},
              'played': 3,
              'won': 2,
              'drawn': 1,
              'lost': 0,
              'goalsFor': 7,
              'goalsAgainst': 2,
              'goalDifference': 5,
              'points': 7,
            },
            {
              'rank': 2,
              'team': {'id': 'team-b', 'name': 'Beta FC'},
              'played': 3,
              'won': 2,
              'drawn': 0,
              'lost': 1,
              'goalsFor': 5,
              'goalsAgainst': 3,
              'goalDifference': 2,
              'points': 6,
            },
          ],
      'coverage': {'status': coverageStatus, 'manifestVersion': 3},
    };

MobileStandings _standings({
  String competitionId = 'competition-1',
  String competitionName = 'League One',
  String seasonId = 'season-1',
  String seasonName = '2026/27',
  String status = 'eligible',
  String? explanation,
  String coverageStatus = 'verified_complete',
}) =>
    MobileStandings.fromJson(_standingsJson(
      competitionId: competitionId,
      competitionName: competitionName,
      seasonId: seasonId,
      seasonName: seasonName,
      status: status,
      explanation: explanation,
      coverageStatus: coverageStatus,
    ));

class _StandingsApi extends MobileApiService {
  _StandingsApi(this.load);

  final Future<MobileStandings> Function(String competitionId, String seasonId)
      load;
  final requestedScopes = <String>[];

  @override
  Future<MobileStandings> getPublicStandings({
    required String competitionId,
    required String seasonId,
  }) {
    requestedScopes.add('$competitionId/$seasonId');
    return load(competitionId, seasonId);
  }

  @override
  Future<List<MobileSeason>> getCompetitionSeasons(
          String competitionId) async =>
      [
        MobileSeason(
          id: 'season-1',
          competitionId: competitionId,
          name: '2026/27',
          status: 'active',
        ),
      ];

  @override
  Future<List<MobileFixture>> getSeasonFixtures(String seasonId) async => [];

  @override
  Future<List<MobileClub>> getSeasonTeams(String seasonId) async => [];
}

class _TestHttpClient extends Fake implements HttpClient {
  _TestHttpClient(this.responseBody);

  final String responseBody;
  Uri? requestedUri;
  final _TestHttpHeaders requestHeaders = _TestHttpHeaders();
  Duration? timeout;

  @override
  set connectionTimeout(Duration? value) => timeout = value;

  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    requestedUri = url;
    return _TestHttpRequest(requestHeaders, responseBody);
  }

  @override
  void close({bool force = false}) {}
}

class _TestHttpRequest extends Fake implements HttpClientRequest {
  _TestHttpRequest(this.headers, this.responseBody);

  @override
  final _TestHttpHeaders headers;
  final String responseBody;

  @override
  Future<HttpClientResponse> close() async => _TestHttpResponse(responseBody);
}

class _TestHttpHeaders extends Fake implements HttpHeaders {
  final values = <String, String>{};

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {
    values[name.toLowerCase()] = value.toString();
  }

  @override
  String? value(String name) => values[name.toLowerCase()];
}

class _TestHttpResponse extends Stream<List<int>>
    implements HttpClientResponse {
  _TestHttpResponse(String body)
      : _stream = Stream<List<int>>.value(utf8.encode(body));

  final Stream<List<int>> _stream;

  @override
  int get statusCode => HttpStatus.ok;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) =>
      _stream.listen(
        onData,
        onError: onError,
        onDone: onDone,
        cancelOnError: cancelOnError,
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('parses eligible standings and preserves server row order and stats',
      () {
    final standings = MobileStandings.fromJson(_standingsJson());

    expect(standings.status, 'eligible');
    expect(standings.competitionId, 'competition-1');
    expect(standings.seasonId, 'season-1');
    expect(standings.snapshotSequence, 4);
    expect(standings.rulesetId, 'league-rules');
    expect(standings.coverageStatus, 'verified_complete');
    expect(standings.rows.map((row) => row.teamName), ['Alpha FC', 'Beta FC']);
    expect(standings.rows.first.points, 7);
    expect(standings.rows.first.goalsFor, 7);
    expect(standings.rows.first.goalsAgainst, 2);
    expect(standings.rows.first.goalDifference, 5);
  });

  test('parses provisional status and its server-provided explanation', () {
    final standings = MobileStandings.fromJson(_standingsJson(
      status: 'provisional',
      explanation: 'Schedule coverage is incomplete.',
      coverageStatus: 'incomplete',
    ));

    expect(standings.status, 'provisional');
    expect(standings.explanation, 'Schedule coverage is incomplete.');
    expect(standings.coverageStatus, 'incomplete');
  });

  test('rejects malformed required statistics rather than substituting zero',
      () {
    final json = _standingsJson();
    (json['rows'] as List).first.remove('points');

    expect(() => MobileStandings.fromJson(json), throwsFormatException);
  });

  test('public standings API targets the public path without authorization',
      () async {
    final client = _TestHttpClient(jsonEncode({'data': _standingsJson()}));
    final api = MobileApiService(
      baseUrl: 'https://api.example.test',
      httpClientFactory: () => client,
    );
    final result = await api.getPublicStandings(
      competitionId: 'competition-1',
      seasonId: 'season-1',
    );

    expect(
        client.requestedUri?.path, '/public/standings/competition-1/season-1');
    expect(
        client.requestHeaders.value(HttpHeaders.authorizationHeader), isNull);
    expect(client.requestHeaders.value(HttpHeaders.cacheControlHeader),
        'no-store');
    expect(result.status, 'eligible');
  });

  testWidgets('Table destination renders ranked rows and all key statistics',
      (tester) async {
    final api = _StandingsApi((competitionId, seasonId) async => _standings());
    await tester.pumpWidget(MaterialApp(
      home: CompetitionHubScreen(
        sport: const MobileSport(id: 'sport-1', name: 'Soccer'),
        host: const MobileHost(id: 'host-1', sportId: 'sport-1', name: 'Spain'),
        competition: const MobileCompetition(
          id: 'competition-1',
          name: 'League One',
          sportId: 'sport-1',
        ),
        api: api,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Table'));
    await tester.pumpAndSettle();

    expect(find.text('League One · 2026/27'), findsOneWidget);
    expect(find.text('Alpha FC'), findsOneWidget);
    expect(find.text('Beta FC'), findsOneWidget);
    expect(find.text('PROVISIONAL STANDINGS'), findsNothing);
    expect(find.byTooltip('Refresh standings'), findsOneWidget);
    expect(api.requestedScopes, ['competition-1/season-1']);
    expect(tester.getTopLeft(find.text('Alpha FC')).dy,
        lessThan(tester.getTopLeft(find.text('Beta FC')).dy));
    for (final statistic in ['7', '2', '5', 'Pts', 'GF', 'GA', 'GD']) {
      expect(find.text(statistic), findsWidgets);
    }
  });

  testWidgets('provisional standings show label and explanation',
      (tester) async {
    final api = _StandingsApi((competitionId, seasonId) async => _standings(
          status: 'provisional',
          explanation: 'Coverage is not verified yet.',
          coverageStatus: 'unassessed',
        ));
    await tester.pumpWidget(MaterialApp(
      home: MobileStandingsSection(
        competitionId: 'competition-1',
        seasonId: 'season-1',
        api: api,
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('PROVISIONAL STANDINGS'), findsOneWidget);
    expect(find.text('Coverage is not verified yet.'), findsOneWidget);
    expect(find.textContaining('Coverage: unassessed'), findsOneWidget);
  });

  testWidgets('loading and no-snapshot states are explicit', (tester) async {
    final pending = Completer<MobileStandings>();
    final api = _StandingsApi((competitionId, seasonId) => pending.future);
    await tester.pumpWidget(MaterialApp(
      home: MobileStandingsSection(
        competitionId: 'competition-1',
        seasonId: 'season-1',
        api: api,
      ),
    ));
    expect(find.bySemanticsLabel('Loading standings'), findsOneWidget);

    pending.completeError(
        const MobileApiException('standings_snapshot_not_found', 404));
    await tester.pumpAndSettle();
    expect(find.text('Standings are not available yet for this season.'),
        findsOneWidget);
    expect(find.text('Refresh'), findsOneWidget);
  });

  testWidgets('retry action fetches again after a request failure',
      (tester) async {
    var attempts = 0;
    final api = _StandingsApi((competitionId, seasonId) {
      attempts++;
      if (attempts == 1) {
        return Future.error(const SocketException('offline'));
      }
      return Future.value(_standings());
    });
    await tester.pumpWidget(MaterialApp(
      home: MobileStandingsSection(
        competitionId: 'competition-1',
        seasonId: 'season-1',
        api: api,
      ),
    ));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'Unable to load standings. Check your connection and try again.'),
        findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(attempts, 2);
    expect(find.text('Alpha FC'), findsOneWidget);
  });

  testWidgets('changing competition and season reloads and ignores stale data',
      (tester) async {
    final oldResult = Completer<MobileStandings>();
    final newResult = Completer<MobileStandings>();
    final api = _StandingsApi((competitionId, seasonId) =>
        seasonId == 'season-old' ? oldResult.future : newResult.future);
    Widget screen(String competitionId, String seasonId) => MaterialApp(
          home: MobileStandingsSection(
            competitionId: competitionId,
            seasonId: seasonId,
            api: api,
          ),
        );

    await tester.pumpWidget(screen('competition-old', 'season-old'));
    expect(api.requestedScopes, ['competition-old/season-old']);
    await tester.pumpWidget(screen('competition-new', 'season-new'));
    expect(api.requestedScopes,
        ['competition-old/season-old', 'competition-new/season-new']);

    newResult.complete(_standings(
      competitionId: 'competition-new',
      competitionName: 'New League',
      seasonId: 'season-new',
      seasonName: '2027',
    ));
    await tester.pump();
    await tester.pump();
    expect(find.text('New League · 2027'), findsOneWidget);

    oldResult.complete(_standings(
      competitionId: 'competition-old',
      competitionName: 'Old League',
      seasonId: 'season-old',
      seasonName: '2026',
    ));
    await tester.pump();
    await tester.pump();
    expect(find.text('New League · 2027'), findsOneWidget);
    expect(find.text('Old League · 2026'), findsNothing);
  });

  testWidgets('malformed data shows safe error with retry', (tester) async {
    const malformed = MobileStandings.fromJson;
    final api = _StandingsApi((competitionId, seasonId) {
      final data = _standingsJson();
      (data['rows'] as List).first.remove('played');
      try {
        return Future.value(malformed(data));
      } catch (error) {
        return Future.error(error);
      }
    });
    await tester.pumpWidget(MaterialApp(
      home: MobileStandingsSection(
        competitionId: 'competition-1',
        seasonId: 'season-1',
        api: api,
      ),
    ));
    await tester.pumpAndSettle();

    expect(
        find.text(
            'Unable to load standings. Check your connection and try again.'),
        findsOneWidget);
    expect(find.textContaining('Standings field'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
  });
}
