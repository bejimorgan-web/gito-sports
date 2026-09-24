import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gito_live_sports_mobile/main.dart';

void main() {
  test('uses the provider live protocol for Xtream playback', () {
    final match = LiveMatch.fromJson({
      'match': {
        'id': 'match-xtream',
        'startsAt': '2026-09-25T18:00:00.000Z',
        'status': 'live',
      },
      'publication': {
        'publicationStatus': 'published',
        'availability': 'ready',
      },
      'playbackMode': 'DIRECT_XTREAM',
      'playbackUrl': 'https://provider.example/live/USER/PASSWORD/123.m3u8',
      'stream': {'status': 'active', 'healthStatus': 'active'},
    });

    expect(match.playbackUrl, 'http://provider.example/live/USER/PASSWORD/123.m3u8');
    expect(match.hasPlayableStream, isTrue);
  });

  test('LiveMatch.fromJson parses top-level and nested payload shapes', () {
    final json = {
      'homeTeamName': 'Green City',
      'awayTeamName': 'Blue United',
      'competitionName': 'Super League',
      'homeTeamLogoUrl': 'https://example.com/green.png',
      'awayTeamLogoUrl': 'https://example.com/blue.png',
      'competitionLogoUrl': 'https://example.com/super-league.png',
      'playbackUrl': 'https://stream.example/live/USER/PASS/123.m3u8',
      'playbackMode': 'DIRECT_XTREAM',
      'publication': {
        'publicationStatus': 'published',
        'availability': 'ready',
      },
      'match': {
        'id': 'match-1',
        'homeTeamId': 'home-1',
        'awayTeamId': 'away-1',
        'competitionId': 'comp-1',
        'startsAt': '2026-06-01T12:00:00Z',
        'status': 'live',
      },
      'stream': {
        'id': 'stream-1',
        'status': 'active',
        'healthStatus': 'active',
      },
    };

    final match = LiveMatch.fromJson(json);

    expect(match.homeTeam, 'Green City');
    expect(match.awayTeam, 'Blue United');
    expect(match.competition, 'Super League');
    expect(match.playbackUrl, 'http://stream.example/live/USER/PASS/123.m3u8');
    expect(match.playbackMode, 'DIRECT_XTREAM');
    expect(match.homeTeamLogoUrl, 'https://example.com/green.png');
    expect(match.competitionLogoUrl, 'https://example.com/super-league.png');
    expect(match.hasPlayableStream, isTrue);
  });

  test('production logo fields remain owned by their canonical entities', () {
    final match = LiveMatch.fromJson({
      'match': {
        'id': 'logo-match',
        'startsAt': '2026-06-01T12:00:00Z',
        'status': 'live',
      },
      'publication': {
        'publicationStatus': 'published',
        'availability': 'ready',
      },
      'sportName': 'Football',
      'sportLogoUrl': 'https://example.com/sport.png',
      'hostName': 'England',
      'hostLogoUrl': 'https://example.com/host.png',
      'competitionName': 'League',
      'competitionLogoUrl': 'https://example.com/competition.png',
      'homeTeamName': 'Home',
      'homeTeamLogoUrl': 'https://example.com/home.png',
      'awayTeamName': 'Away',
      'awayTeamLogoUrl': 'https://example.com/away.png',
      'playbackUrl': 'https://media.example/live.m3u8',
      'stream': {'status': 'active', 'healthStatus': 'active'},
    });

    expect(match.sportLogoUrl, 'https://example.com/sport.png');
    expect(match.hostLogoUrl, 'https://example.com/host.png');
    expect(match.competitionLogoUrl, 'https://example.com/competition.png');
    expect(match.homeTeamLogoUrl, 'https://example.com/home.png');
    expect(match.awayTeamLogoUrl, 'https://example.com/away.png');
  });

  test(
      'LiveMatch.fromJson falls back to nested fields when top-level keys are missing',
      () {
    final json = {
      'match': {
        'id': 'match-2',
        'homeTeamName': 'Red FC',
        'awayTeamName': 'Yellow FC',
        'competitionName': 'Champions Cup',
        'homeTeamLogoUrl': 'https://example.com/red.png',
        'awayTeamLogoUrl': 'https://example.com/yellow.png',
        'competitionLogoUrl': 'https://example.com/champions.png',
        'startsAt': '2026-06-02T15:00:00Z',
        'status': 'live',
      },
      'stream': {
        'id': 'stream-2',
        'status': 'active',
        'healthStatus': 'active',
      },
      'playbackUrl': 'https://stream.example/live2.m3u8',
      'publication': {
        'publicationStatus': 'published',
        'availability': 'ready',
      },
    };

    final match = LiveMatch.fromJson(json);

    expect(match.homeTeam, 'Red FC');
    expect(match.awayTeam, 'Yellow FC');
    expect(match.competition, 'Champions Cup');
    expect(match.playbackUrl, 'https://stream.example/live2.m3u8');
    expect(match.hasPlayableStream, isTrue);
  });

  test(
      'LiveMatch.fromJson does not use legacy URL fields when playbackUrl is absent',
      () {
    final match = LiveMatch.fromJson({
      'match': {'id': 'match-3', 'status': 'published'},
      'stream': {
        'id': 'stream-3',
        'status': 'active',
        'healthStatus': 'active',
        'url': 'https://legacy.example/secret.m3u8',
      },
      'publication': {
        'publicationStatus': 'published',
        'availability': 'ready',
      },
      'channel': {'url': 'https://legacy.example/channel.m3u8'},
    });

    expect(match.playbackUrl, isEmpty);
  });

  test('production-shaped payload separates match and publication lifecycle',
      () {
    LiveMatch parse(String publicationStatus, String availability) {
      return LiveMatch.fromJson({
        'match': {
          'id': 'production-match',
          'startsAt': '2026-06-01T12:00:00Z',
          'status': 'live',
        },
        'publication': {
          'publicationStatus': publicationStatus,
          'availability': availability,
        },
        'playbackUrl': 'https://media.example/live.m3u8',
        'stream': {
          'id': 'production-publication',
          'status': availability == 'offline' || availability == 'unknown'
              ? 'unavailable'
              : 'active',
          'healthStatus': availability == 'ready'
              ? 'active'
              : availability == 'degraded'
                  ? 'degraded'
                  : availability == 'offline'
                      ? 'failed'
                      : 'unknown',
        },
      });
    }

    expect(parse('published', 'ready').hasPlayableStream, isTrue);
    expect(parse('published', 'offline').hasPlayableStream, isFalse);
    expect(parse('published', 'unknown').hasPlayableStream, isFalse);
    expect(parse('draft', 'ready').hasPlayableStream, isFalse);
    expect(parse('published', 'degraded').hasPlayableStream, isTrue);
  });

  group('Live eligibility timing', () {
    final now = DateTime.utc(2026, 6, 1, 12, 0, 0);

    test('31 minutes before kickoff is not live', () {
      final kickoff = now.add(const Duration(minutes: 31));
      expect(LiveEligibility.isLiveWindow(kickoff, 'published', now), isFalse);
    });

    test('30 minutes before kickoff is live', () {
      final kickoff = now.add(const Duration(minutes: 30));
      expect(LiveEligibility.isLiveWindow(kickoff, 'published', now), isTrue);
    });

    test('15 minutes before kickoff is live', () {
      final kickoff = now.add(const Duration(minutes: 15));
      expect(LiveEligibility.isLiveWindow(kickoff, 'published', now), isTrue);
    });

    test('kickoff time is live', () {
      expect(LiveEligibility.isLiveWindow(now, 'published', now), isTrue);
    });

    test('20 minutes after kickoff remains live while active', () {
      final kickoff = now.subtract(const Duration(minutes: 20));
      expect(LiveEligibility.isLiveWindow(kickoff, 'published', now), isTrue);
    });

    test('ended matches are not live', () {
      final kickoff = now.subtract(const Duration(minutes: 10));
      expect(LiveEligibility.isLiveWindow(kickoff, 'ended', now), isFalse);
    });

    test('cancelled matches are not live', () {
      final kickoff = now.subtract(const Duration(minutes: 10));
      expect(LiveEligibility.isLiveWindow(kickoff, 'cancelled', now), isFalse);
    });

    test('missing kickoff is not live', () {
      expect(
          LiveEligibility.isLiveWindow(DateTime(0), 'published', now), isFalse);
    });
  });

  test('global Live OFF blocks Watch Now and playback', () {
    final match = LiveMatch(
      id: 'm-1',
      homeTeam: 'Home',
      awayTeam: 'Away',
      competition: 'League',
      startsAt: DateTime.utc(2026, 6, 1, 12, 30, 0),
      matchStatus: 'live',
      publicationStatus: 'published',
      publicationAvailability: 'ready',
      streamStatus: 'active',
      streamHealth: 'active',
      playbackUrl: 'https://example.com/live.m3u8',
    );

    expect(
        LiveEligibility.isWatchNowAllowed(match, liveEnabled: false), isFalse);
    expect(LiveEligibility.isWatchNowAllowed(match, liveEnabled: true), isTrue);
  });

  LiveMatch hierarchyMatch({
    required String id,
    required String sport,
    required String host,
    required String competition,
    DateTime? startsAt,
    String status = 'live',
    String publicationStatus = 'published',
  }) {
    return LiveMatch(
      id: id,
      homeTeam: 'Home $id',
      awayTeam: 'Away $id',
      competition: competition,
      sportName: sport,
      hostName: host,
      startsAt: startsAt ?? DateTime.utc(2026, 6, 1, 12),
      matchStatus: status,
      publicationStatus: publicationStatus,
      publicationAvailability: 'ready',
      streamStatus: 'active',
      streamHealth: 'active',
      playbackUrl: 'https://example.com/$id.m3u8',
      sportLogoUrl: 'https://example.com/$sport.png',
      hostLogoUrl: 'https://example.com/$host.png',
      competitionLogoUrl: 'https://example.com/$competition.png',
      homeTeamLogoUrl: 'https://example.com/home-$id.png',
      awayTeamLogoUrl: 'https://example.com/away-$id.png',
    );
  }

  test('Live hierarchy groups and counts only eligible canonical matches', () {
    final now = DateTime.utc(2026, 6, 1, 12);
    final matches = [
      hierarchyMatch(
          id: '1', sport: 'Soccer', host: 'Spain', competition: 'La Liga'),
      hierarchyMatch(
          id: '2', sport: 'Soccer', host: 'Spain', competition: 'La Liga'),
      hierarchyMatch(
          id: '3',
          sport: 'Soccer',
          host: 'England',
          competition: 'Premier League'),
      hierarchyMatch(
          id: '4', sport: 'Tennis', host: 'France', competition: 'Open'),
      hierarchyMatch(
          id: 'ended',
          sport: 'Soccer',
          host: 'Spain',
          competition: 'La Liga',
          status: 'ended'),
      hierarchyMatch(
          id: 'draft',
          sport: 'Soccer',
          host: 'Spain',
          competition: 'La Liga',
          publicationStatus: 'draft'),
      hierarchyMatch(
          id: 'future',
          sport: 'Soccer',
          host: 'Spain',
          competition: 'La Liga',
          startsAt: now.add(const Duration(minutes: 31))),
    ];

    final sports = groupLiveMatchesBySport(matches, now: now);
    expect(sports.keys, ['Soccer', 'Tennis']);
    expect(sports['Soccer'], hasLength(3));
    expect(sports['Tennis'], hasLength(1));

    final hosts = groupLiveMatchesByHost(matches, 'Soccer', now: now);
    expect(hosts.keys, ['England', 'Spain']);
    expect(hosts['Spain'], hasLength(2));

    final competitions =
        groupLiveMatchesByCompetition(matches, 'Soccer', 'Spain', now: now);
    expect(competitions.keys, ['La Liga']);
    expect(competitions['La Liga'], hasLength(2));
    expect(filterLiveMatches(matches, 'Soccer', 'Spain', 'La Liga', now: now),
        hasLength(2));
    expect(groupLiveMatchesBySport(matches, liveEnabled: false, now: now),
        isEmpty);
  });

  testWidgets('live logo containers are white and contain their source image',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
          body: WhiteLogoBox(
              url: 'https://example.com/logo.png', label: 'Soccer')),
    ));

    final logoBox = tester.widget<WhiteLogoBox>(find.byType(WhiteLogoBox));
    final container = tester.widget<Container>(find.byType(Container).first);
    expect(container.decoration, isA<BoxDecoration>());
    expect((container.decoration! as BoxDecoration).color, Colors.white);
    expect((container.decoration! as BoxDecoration).shape, BoxShape.circle);
    expect(logoBox.size, greaterThanOrEqualTo(54));
    final image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.contain);
  });

  testWidgets('logo containers preserve the fallback for missing assets',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: WhiteLogoBox(url: null, label: 'Soccer')),
    ));

    expect(find.text('S'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('bundled playback emblem is top-right with opaque covering area',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Stack(
          children: [
            SizedBox.expand(child: Text('video')),
            PlayerBrandOverlay(
              videoSize: const Size(360, 640),
              landscapeWidthRatio: 0.2,
            ),
          ],
        ),
      ),
    ));

    final positioned = tester.widget<Positioned>(find.byType(Positioned));
    expect(positioned, isA<Positioned>());
    final backing = tester.widget<Container>(find.byType(Container).last);
    expect(backing.decoration, isA<BoxDecoration>());
    final decoration = backing.decoration! as BoxDecoration;
    expect(decoration.color, Colors.black);
    expect(decoration.borderRadius, BorderRadius.circular(8));
    final backingSize = tester.getSize(find.byType(Container).last);
    expect(backingSize.width, greaterThan(0));
    expect(backingSize.height, greaterThan(0));
    expect(find.byType(Image), findsOneWidget);
    expect(tester.widget<Image>(find.byType(Image)).fit, BoxFit.contain);
  });

  testWidgets(
      'bundled playback emblem keeps its video-local anchor in both orientations',
      (tester) async {
    Future<void> pumpVideoSurface(Size size) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox.fromSize(
              size: size,
              child: Stack(
                children: [
                  PlayerBrandOverlay(
                    videoSize: size,
                    landscapeWidthRatio: 160 / 640,
                  ),
                ],
              ),
            ),
          ),
        ),
      ));
      expect(find.byType(Align), findsOneWidget);
      expect(find.byType(Padding), findsWidgets);
      expect(find.byType(Image), findsOneWidget);
      final backingSize = tester.getSize(find.byType(Container).last);
      if (size.width > size.height) {
        expect(backingSize.width, PlayerBrandOverlay.landscapeBackingWidth);
        expect(backingSize.height, PlayerBrandOverlay.landscapeBackingHeight);
      } else {
        expect(backingSize.width,
          closeTo(size.width * (160 / 640) * PlayerBrandOverlay.portraitScale, 0.01));
        expect(backingSize.height,
          closeTo(backingSize.width / (160 / 58), 0.01));
      }
    }

    await pumpVideoSurface(const Size(360, 640));
    await pumpVideoSurface(const Size(640, 360));
  });
}
