import 'package:flutter_test/flutter_test.dart';
import 'package:gito_live_sports_mobile/models/mobile_models.dart';

defaultFixture() => <String, dynamic>{
      'id': 'match-1',
      'startsAt': '2026-08-20T15:00:00Z',
      'status': 'scheduled',
      'venue': 'Arena',
      'competition': {
        'id': 'competition-1',
        'name': 'Bundesliga',
        'slug': 'bundesliga'
      },
      'season': {
        'id': 'season-1',
        'competitionId': 'competition-1',
        'name': '2026/27',
        'status': 'active'
      },
      'sport': {'id': 'sport-1', 'name': 'Football'},
      'country': {'id': 'country-1', 'name': 'Germany'},
      'homeClub': {
        'id': 'team-bayern',
        'name': 'Bayern Munich',
        'sportId': 'sport-1',
        'status': 'active'
      },
      'awayClub': {
        'id': 'team-dortmund',
        'name': 'Borussia Dortmund',
        'sportId': 'sport-1',
        'status': 'active'
      },
      'score': null,
      'live': false,
      'streams': [],
    };

void main() {
  test('parses stable club identity and nested catalog records', () {
    final club = MobileClub.fromJson({
      'id': 'team-bayern',
      'name': 'Bayern Munich',
      'shortName': 'Bayern',
      'slug': 'bayern-munich',
      'sportId': 'sport-1',
      'countryId': 'country-1',
      'status': 'active',
      'sport': {'id': 'sport-1', 'name': 'Football'},
      'country': {'id': 'country-1', 'name': 'Germany'},
    });

    expect(club.id, 'team-bayern');
    expect(club.country?.id, 'country-1');
    expect(club.sport?.id, 'sport-1');
  });

  test('preserves nullable scores without fabricating 0-0', () {
    final fixture = MobileFixture.fromJson(defaultFixture());
    expect(fixture.id, 'match-1');
    expect(fixture.score, isNull);
    expect(fixture.scoreLabel, 'scheduled');
  });

  test('preserves fixture and stream IDs', () {
    final json = defaultFixture();
    json['streams'] = [
      {
        'id': 'stream-1',
        'matchId': 'match-1',
        'channelId': 'channel-1',
        'channelName': 'Sports HD',
        'providerId': 'provider-1',
        'providerName': 'Provider',
        'status': 'active',
        'approvalStatus': 'active',
        'healthStatus': 'active',
      }
    ];
    final fixture = MobileFixture.fromJson(json);
    expect(fixture.homeClub.id, 'team-bayern');
    expect(fixture.awayClub.id, 'team-dortmund');
    expect(fixture.streams.single.channelId, 'channel-1');
    expect(fixture.streams.single.providerId, 'provider-1');
  });

  test('parses seasons and club details', () {
    final season = MobileSeason.fromJson({
      'id': 'season-1',
      'competitionId': 'competition-1',
      'name': '2026/27',
      'status': 'active'
    });
    final detail = MobileClubDetail.fromJson({
      'club': {
        'id': 'team-bayern',
        'name': 'Bayern Munich',
        'sportId': 'sport-1',
        'status': 'active'
      },
      'competitions': [],
      'seasons': [
        {
          'id': season.id,
          'competitionId': season.competitionId,
          'name': season.name,
          'status': season.status
        }
      ],
      'nextFixture': defaultFixture(),
      'previousResult': null,
    });
    expect(detail.club.id, 'team-bayern');
    expect(detail.seasons.single.id, 'season-1');
    expect(detail.nextFixture?.id, 'match-1');
  });

  test('parses News media, body, and source metadata', () {
    final article = MobileNewsArticle.fromJson({
      'id': 'article-1',
      'title': 'Match report',
      'summary': 'A concise summary',
      'body': 'The full article body.',
      'status': 'published',
      'sourceName': 'GiTO News',
      'sourceUrl': 'https://example.com/article-1',
      'publishedAt': '2026-08-20T12:00:00Z',
      'imageUrl': 'https://example.com/images/article-1.jpg',
    });

    expect(article.id, 'article-1');
    expect(article.imageUrl, 'https://example.com/images/article-1.jpg');
    expect(article.body, 'The full article body.');
    expect(article.sourceName, 'GiTO News');
  });

  test('accepts missing News media and body', () {
    final article = MobileNewsArticle.fromJson({
      'id': 'article-2',
      'title': 'Headline only',
      'status': 'published',
      'media': [],
    });

    expect(article.imageUrl, isNull);
    expect(article.body, isNull);
  });
}
