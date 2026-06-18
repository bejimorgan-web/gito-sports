import 'package:flutter_test/flutter_test.dart';
import 'package:gito_live_sports_mobile/main.dart';

void main() {
  test('LiveMatch.fromJson parses top-level and nested payload shapes', () {
    final json = {
      'homeTeamName': 'Green City',
      'awayTeamName': 'Blue United',
      'competitionName': 'Super League',
      'homeTeamLogoUrl': 'https://example.com/green.png',
      'awayTeamLogoUrl': 'https://example.com/blue.png',
      'competitionLogoUrl': 'https://example.com/super-league.png',
      'playbackUrl': 'https://stream.example/live.m3u8',
      'match': {
        'id': 'match-1',
        'homeTeamId': 'home-1',
        'awayTeamId': 'away-1',
        'competitionId': 'comp-1',
        'startsAt': '2026-06-01T12:00:00Z',
        'status': 'published',
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
    expect(match.playbackUrl, 'https://stream.example/live.m3u8');
    expect(match.homeTeamLogoUrl, 'https://example.com/green.png');
    expect(match.competitionLogoUrl, 'https://example.com/super-league.png');
    expect(match.hasPlayableStream, isTrue);
  });

  test('LiveMatch.fromJson falls back to nested fields when top-level keys are missing', () {
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
        'status': 'published',
      },
      'stream': {
        'id': 'stream-2',
        'status': 'active',
        'healthStatus': 'active',
      },
      'playbackUrl': 'https://stream.example/live2.m3u8',
    };

    final match = LiveMatch.fromJson(json);

    expect(match.homeTeam, 'Red FC');
    expect(match.awayTeam, 'Yellow FC');
    expect(match.competition, 'Champions Cup');
    expect(match.playbackUrl, 'https://stream.example/live2.m3u8');
    expect(match.hasPlayableStream, isTrue);
  });
}
