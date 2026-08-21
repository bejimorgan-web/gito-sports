class MobileSport {
  const MobileSport(
      {required this.id, required this.name, this.slug, this.logoUrl});
  final String id;
  final String name;
  final String? slug;
  final String? logoUrl;
  factory MobileSport.fromJson(Map<String, dynamic> json) => MobileSport(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      slug: json['slug']?.toString(),
      logoUrl: json['logoUrl']?.toString());
}

class MobileCountry {
  const MobileCountry({required this.id, required this.name});
  final String id;
  final String name;
  factory MobileCountry.fromJson(Map<String, dynamic> json) =>
      MobileCountry(id: '${json['id'] ?? ''}', name: '${json['name'] ?? ''}');
}

class MobileClub {
  const MobileClub(
      {required this.id,
      required this.name,
      this.shortName,
      this.slug,
      this.logoUrl,
      required this.sportId,
      this.countryId,
      required this.status,
      this.sport,
      this.country});
  final String id;
  final String name;
  final String? shortName;
  final String? slug;
  final String? logoUrl;
  final String sportId;
  final String? countryId;
  final String status;
  final MobileSport? sport;
  final MobileCountry? country;
  factory MobileClub.fromJson(Map<String, dynamic> json) => MobileClub(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      shortName: json['shortName']?.toString(),
      slug: json['slug']?.toString(),
      logoUrl: json['logoUrl']?.toString(),
      sportId: '${json['sportId'] ?? json['sport']?['id'] ?? ''}',
      countryId:
          json['countryId']?.toString() ?? json['country']?['id']?.toString(),
      status: '${json['status'] ?? ''}',
      sport: json['sport'] is Map
          ? MobileSport.fromJson(
              Map<String, dynamic>.from(json['sport'] as Map))
          : null,
      country: json['country'] is Map
          ? MobileCountry.fromJson(
              Map<String, dynamic>.from(json['country'] as Map))
          : null);
}

class MobileCompetition {
  const MobileCompetition({required this.id, required this.name, this.slug});
  final String id;
  final String name;
  final String? slug;
  factory MobileCompetition.fromJson(Map<String, dynamic> json) =>
      MobileCompetition(
          id: '${json['id'] ?? ''}',
          name: '${json['name'] ?? ''}',
          slug: json['slug']?.toString());
}

class MobileSeason {
  const MobileSeason(
      {required this.id,
      required this.competitionId,
      required this.name,
      this.startsAt,
      this.endsAt,
      required this.status});
  final String id;
  final String competitionId;
  final String name;
  final String? startsAt;
  final String? endsAt;
  final String status;
  factory MobileSeason.fromJson(Map<String, dynamic> json) => MobileSeason(
      id: '${json['id'] ?? ''}',
      competitionId:
          '${json['competitionId'] ?? json['competition']?['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      startsAt: json['startsAt']?.toString(),
      endsAt: json['endsAt']?.toString(),
      status: '${json['status'] ?? ''}');
}

class MobileStream {
  const MobileStream(
      {required this.id,
      required this.matchId,
      required this.channelId,
      required this.channelName,
      required this.providerId,
      required this.providerName,
      required this.status,
      required this.approvalStatus,
      required this.healthStatus});
  final String id;
  final String matchId;
  final String channelId;
  final String channelName;
  final String providerId;
  final String providerName;
  final String status;
  final String approvalStatus;
  final String healthStatus;
  factory MobileStream.fromJson(Map<String, dynamic> json) => MobileStream(
      id: '${json['id'] ?? ''}',
      matchId: '${json['matchId'] ?? ''}',
      channelId: '${json['channelId'] ?? ''}',
      channelName: '${json['channelName'] ?? ''}',
      providerId: '${json['providerId'] ?? ''}',
      providerName: '${json['providerName'] ?? ''}',
      status: '${json['status'] ?? ''}',
      approvalStatus: '${json['approvalStatus'] ?? ''}',
      healthStatus: '${json['healthStatus'] ?? ''}');
}

class MobileNewsBodyBlock {
    const MobileNewsBodyBlock({required this.type, this.text, this.url, this.platform, this.altText, this.caption, this.enabled = true});
    final String type;
    final String? text;
    final String? url;
    final String? platform;
    final String? altText;
    final String? caption;
    final bool enabled;

    factory MobileNewsBodyBlock.fromJson(Map<String, dynamic> json) => MobileNewsBodyBlock(
            type: '${json['type'] ?? 'paragraph'}',
            text: json['text']?.toString(),
            url: json['url']?.toString(),
            platform: json['platform']?.toString(),
            altText: json['altText']?.toString(),
            caption: json['caption']?.toString(),
            enabled: json['enabled'] != false);
}

class MobileNewsCategory {
  const MobileNewsCategory({required this.type, this.entityId, this.name});
  final String type;
  final String? entityId;
  final String? name;

  factory MobileNewsCategory.fromJson(Map<String, dynamic> json) =>
      MobileNewsCategory(
        type: '${json['type'] ?? json['categoryType'] ?? ''}',
        entityId: json['entityId']?.toString() ?? json['entity_id']?.toString(),
        name: json['name']?.toString(),
      );
}

class MobileNewsArticle {
  const MobileNewsArticle(
      {required this.id,
      required this.title,
      this.summary,
      this.body,
      required this.status,
      this.sourceName,
      this.sourceUrl,
      this.publishedAt,
      this.imageUrl,
      this.bodyBlocks = const [],
      this.categories = const [],
      this.sport,
      this.competition,
      this.team,
      this.country,
      this.match});
  final String id;
  final String title;
  final String? summary;
  final String? body;
  final String status;
  final String? sourceName;
  final String? sourceUrl;
  final String? publishedAt;
  final String? imageUrl;
  final List<MobileNewsBodyBlock> bodyBlocks;
  final List<MobileNewsCategory> categories;
  final MobileSport? sport;
  final MobileCompetition? competition;
  final MobileClub? team;
  final MobileCountry? country;
  final Map<String, dynamic>? match;

  factory MobileNewsArticle.fromJson(Map<String, dynamic> json) =>
      MobileNewsArticle(
          id: '${json['id'] ?? ''}',
          title: '${json['title'] ?? ''}',
          summary: json['summary']?.toString(),
          body: json['body']?.toString(),
          status: '${json['status'] ?? ''}',
          sourceName: json['sourceName']?.toString() ??
              json['source']?['name']?.toString(),
          sourceUrl: json['sourceUrl']?.toString(),
          publishedAt: json['publishedAt']?.toString(),
          imageUrl: json['imageUrl']?.toString() ??
              ((json['media'] is List && (json['media'] as List).isNotEmpty)
                  ? ((json['media'] as List).first as Map)['url']?.toString()
                  : null),
          bodyBlocks: (json['bodyBlocks'] as List? ?? const [])
              .whereType<Map>()
              .map((item) => MobileNewsBodyBlock.fromJson(Map<String, dynamic>.from(item)))
              .toList(),
          categories: (json['categories'] as List? ?? const [])
              .whereType<Map>()
              .map((item) => MobileNewsCategory.fromJson(Map<String, dynamic>.from(item)))
              .toList(),
          sport: json['sport'] is Map
              ? MobileSport.fromJson(Map<String, dynamic>.from(json['sport'] as Map))
              : null,
          competition: json['competition'] is Map
              ? MobileCompetition.fromJson(Map<String, dynamic>.from(json['competition'] as Map))
              : null,
          team: json['team'] is Map
              ? MobileClub.fromJson(Map<String, dynamic>.from(json['team'] as Map))
              : null,
          country: json['country'] is Map
              ? MobileCountry.fromJson(Map<String, dynamic>.from(json['country'] as Map))
              : null,
          match: json['match'] is Map
              ? Map<String, dynamic>.from(json['match'] as Map)
              : null);
}

class MobileFixture {
  const MobileFixture(
      {required this.id,
      required this.startsAt,
      required this.status,
      this.venue,
      required this.competition,
      this.season,
      this.sport,
      this.country,
      required this.homeClub,
      required this.awayClub,
      this.score,
      required this.live,
      required this.streams});
  final String id;
  final DateTime? startsAt;
  final String status;
  final String? venue;
  final MobileCompetition competition;
  final MobileSeason? season;
  final MobileSport? sport;
  final MobileCountry? country;
  final MobileClub homeClub;
  final MobileClub awayClub;
  final Map<String, dynamic>? score;
  final bool live;
  final List<MobileStream> streams;
  factory MobileFixture.fromJson(Map<String, dynamic> json) => MobileFixture(
      id: '${json['id'] ?? ''}',
      startsAt: DateTime.tryParse('${json['startsAt'] ?? ''}'),
      status: '${json['status'] ?? ''}',
      venue: json['venue']?.toString(),
      competition: MobileCompetition.fromJson(
          Map<String, dynamic>.from(json['competition'] as Map? ?? const {})),
      season: json['season'] is Map
          ? MobileSeason.fromJson(
              Map<String, dynamic>.from(json['season'] as Map))
          : null,
      sport: json['sport'] is Map
          ? MobileSport.fromJson(
              Map<String, dynamic>.from(json['sport'] as Map))
          : null,
      country: json['country'] is Map
          ? MobileCountry.fromJson(
              Map<String, dynamic>.from(json['country'] as Map))
          : null,
      homeClub: MobileClub.fromJson(
          Map<String, dynamic>.from(json['homeClub'] as Map? ?? const {})),
      awayClub: MobileClub.fromJson(
          Map<String, dynamic>.from(json['awayClub'] as Map? ?? const {})),
      score: json['score'] is Map
          ? Map<String, dynamic>.from(json['score'] as Map)
          : null,
      live: json['live'] == true,
      streams: (json['streams'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => MobileStream.fromJson(Map<String, dynamic>.from(item)))
          .toList());
  String get scoreLabel {
    if (score == null) return live ? 'LIVE' : status;
    final home = score?['home'];
    final away = score?['away'];
    return home == null || away == null ? status : '$home - $away';
  }
}

class MobileClubDetail {
  const MobileClubDetail(
      {required this.club,
      required this.competitions,
      required this.seasons,
      this.nextFixture,
      this.previousResult});
  final MobileClub club;
  final List<MobileCompetition> competitions;
  final List<MobileSeason> seasons;
  final MobileFixture? nextFixture;
  final MobileFixture? previousResult;
  factory MobileClubDetail.fromJson(Map<String, dynamic> json) =>
      MobileClubDetail(
          club: MobileClub.fromJson(
              Map<String, dynamic>.from(json['club'] as Map? ?? const {})),
          competitions: (json['competitions'] as List? ?? const [])
              .whereType<Map>()
              .map((item) =>
                  MobileCompetition.fromJson(Map<String, dynamic>.from(item)))
              .toList(),
          seasons: (json['seasons'] as List? ?? const [])
              .whereType<Map>()
              .map((item) =>
                  MobileSeason.fromJson(Map<String, dynamic>.from(item)))
              .toList(),
          nextFixture: json['nextFixture'] is Map
              ? MobileFixture.fromJson(
                  Map<String, dynamic>.from(json['nextFixture'] as Map))
              : null,
          previousResult: json['previousResult'] is Map
              ? MobileFixture.fromJson(
                  Map<String, dynamic>.from(json['previousResult'] as Map))
              : null);
}
