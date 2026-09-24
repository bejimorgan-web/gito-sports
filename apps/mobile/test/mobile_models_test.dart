import 'package:flutter_test/flutter_test.dart';
import 'package:gito_live_sports_mobile/app_config.dart';
import 'package:gito_live_sports_mobile/models/mobile_models.dart';

void additionalModelContractTests() {
  test('normalizes catalog media URLs against the configured API base', () {
    expect(
      normalizeMediaUrl('/uploads/logo.png', baseUrl: 'https://api.example.com'),
      'https://api.example.com/uploads/logo.png',
    );
    expect(
      normalizeMediaUrl('https://cdn.example.com/logo.png', baseUrl: 'https://api.example.com'),
      'https://cdn.example.com/logo.png',
    );
    expect(
      normalizeMediaUrl('http://cdn.example.com/logo.png', baseUrl: 'https://api.example.com'),
      'http://cdn.example.com/logo.png',
    );
    expect(normalizeMediaUrl(null), isNull);
    expect(normalizeMediaUrl(''), isNull);
  });

  test('catalog models preserve canonical logo fields', () {
    final sport = MobileSport.fromJson({'id': 'sport-1', 'name': 'Soccer', 'logoUrl': '/uploads/sport.png'});
    final host = MobileHost.fromJson({'id': 'host-1', 'sportId': 'sport-1', 'name': 'Germany', 'logoUrl': '/uploads/host.png'});
    final competition = MobileCompetition.fromJson({'id': 'competition-1', 'name': 'Bundesliga', 'sportId': 'sport-1', 'hostId': 'host-1', 'logoUrl': '/uploads/competition.png'});
    final club = MobileClub.fromJson({'id': 'team-1', 'name': 'Bayern Munich', 'sportId': 'sport-1', 'status': 'active', 'logoUrl': '/uploads/team.png'});

    expect(sport.logoUrl, '$apiBaseUrl/uploads/sport.png');
    expect(host.logoUrl, '$apiBaseUrl/uploads/host.png');
    expect(competition.logoUrl, '$apiBaseUrl/uploads/competition.png');
    expect(competition.hostId, 'host-1');
    expect(club.logoUrl, '$apiBaseUrl/uploads/team.png');
  });
}

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
  additionalModelContractTests();
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

  test('parses provider-neutral published publication metadata without streams',
      () {
    final publication = MobilePublishedPublication.fromJson({
      'publication': {
        'schemaVersion': 1,
        'publicationId': 'publication-1',
        'matchId': 'match-1',
        'sourceReference': 'source-opaque-1',
        'capability': 'live',
        'publicationStatus': 'published',
        'availability': 'ready',
        'expiresAt': null,
      },
      'match': {
        'id': 'match-1',
        'competitionId': 'competition-1',
        'homeTeamId': 'team-home',
        'awayTeamId': 'team-away',
        'startsAt': '2026-08-20T15:00:00Z',
        'competitionName': 'League',
        'homeTeamName': 'Home FC',
        'awayTeamName': 'Away FC',
      },
    });

    expect(publication.publicationId, 'publication-1');
    expect(publication.publicationStatus, 'published');
    expect(publication.availability, 'ready');
    expect(publication.match.homeTeamName, 'Home FC');
    expect(publication.match.awayTeamName, 'Away FC');
    expect(publication.sourceReference, 'source-opaque-1');
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

  test('preserves ordered News body blocks', () {
    final article = MobileNewsArticle.fromJson({
      'id': 'article-3',
      'title': 'Inline media',
      'status': 'published',
      'bodyBlocks': [
        {'type': 'paragraph', 'text': 'Before'},
        {'type': 'image', 'url': 'https://example.com/image.jpg'},
        {
          'type': 'video',
          'platform': 'youtube',
          'url': 'https://youtube.com/watch?v=1'
        },
        {
          'type': 'social',
          'platform': 'x',
          'url': 'https://x.com/example/status/1'
        },
      ],
    });

    expect(article.bodyBlocks.map((block) => block.type).toList(),
        ['paragraph', 'image', 'video', 'social']);
    expect(article.bodyBlocks[1].url, 'https://example.com/image.jpg');
  });
}
