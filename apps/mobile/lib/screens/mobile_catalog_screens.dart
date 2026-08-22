import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/mobile_models.dart';
import '../services/mobile_api_service.dart';
import '../services/remote_config_service.dart';

class MobileStateView<T> extends StatelessWidget {
  const MobileStateView(
      {required this.future,
      required this.emptyText,
      required this.builder,
      super.key});
  final Future<T> future;
  final String emptyText;
  final Widget Function(BuildContext, T) builder;
  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
              child: Text('Unable to load data.\n${snapshot.error}',
                  textAlign: TextAlign.center));
        }
        final value = snapshot.data;
        if (value is List && value.isEmpty) {
          return Center(child: Text(emptyText));
        }
        if (value == null) {
          return Center(child: Text(emptyText));
        }
        return builder(context, value);
      });
}

class _FollowPreferenceState {
  static const String _sportsKey = 'gito_followed_sports';
  static const String _competitionsKey = 'gito_followed_competitions';
  static const String _teamsKey = 'gito_followed_teams';

  static String _normalize(String? value) {
    final text = (value ?? '').trim().toLowerCase();
    if (text.isEmpty) return '';
    return text
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .trim()
        .replaceAll(RegExp(r'\s+'), ' ');
  }

  static Future<Set<String>> _readPrefs(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final values = prefs.getStringList(key) ?? const <String>[];
    return values
        .map((value) => _normalize(value))
        .where((value) => value.isNotEmpty)
        .toSet();
  }

  static Future<Map<String, Set<String>>> load() async {
    final sports = await _readPrefs(_sportsKey);
    final competitions = await _readPrefs(_competitionsKey);
    final teams = await _readPrefs(_teamsKey);
    return {'sports': sports, 'competitions': competitions, 'teams': teams};
  }

  static bool matchesNews(
      MobileNewsArticle article, Map<String, Set<String>> preferences) {
    final sports = preferences['sports'] ?? const <String>{};
    final competitions = preferences['competitions'] ?? const <String>{};
    final teams = preferences['teams'] ?? const <String>{};

    final searchable = <String>{
      _normalize(article.title),
      _normalize(article.summary),
      _normalize(article.body),
      _normalize(article.sport?.name),
      _normalize(article.competition?.name),
      _normalize(article.team?.name),
      ...article.categories.map((category) =>
          _normalize(category.name ?? category.entityId ?? category.type)),
    };

    if (sports.isNotEmpty &&
        searchable.any((value) => sports.contains(value))) {
      return true;
    }
    if (competitions.isNotEmpty &&
        searchable.any((value) => competitions.contains(value))) {
      return true;
    }
    if (teams.isNotEmpty && searchable.any((value) => teams.contains(value))) {
      return true;
    }
    return false;
  }

  static bool matchesClub(
      MobileClub club, Map<String, Set<String>> preferences) {
    final sports = preferences['sports'] ?? const <String>{};
    final teams = preferences['teams'] ?? const <String>{};
    final values = <String>{
      _normalize(club.name),
      _normalize(club.shortName),
      _normalize(club.slug),
      _normalize(club.sport?.name),
    };
    return values
        .any((value) => teams.contains(value) || sports.contains(value));
  }
}

class ClubsScreen extends StatefulWidget {
  const ClubsScreen({super.key, this.api = const MobileApiService()});
  final MobileApiService api;

  @override
  State<ClubsScreen> createState() => _ClubsScreenState();
}

class _ClubsScreenState extends State<ClubsScreen> {
  late Future<List<MobileClub>> _clubsFuture;

  @override
  void initState() {
    super.initState();
    _clubsFuture = _loadClubs();
  }

  Future<List<MobileClub>> _loadClubs() async {
    final following = await resolveMobileFollowingIds(widget.api);
    return following.teams.isEmpty
        ? widget.api.getClubs()
        : widget.api.getClubs(teamIds: following.teams);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Clubs')),
        body: FutureBuilder<List<MobileClub>>(
          future: _clubsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(
                  child: Text('Unable to load clubs.\n${snapshot.error}'));
            }
            final clubs = snapshot.data ?? const <MobileClub>[];
            if (clubs.isEmpty) {
              return const Center(child: Text('No clubs available.'));
            }
            return RefreshIndicator(
              onRefresh: () async {
                setState(() {
                  _clubsFuture = _loadClubs();
                });
              },
              child: ListView.builder(
                itemCount: clubs.length,
                itemBuilder: (context, index) {
                  final club = clubs[index];
                  return ListTile(
                    leading: _Logo(url: club.logoUrl, label: club.name),
                    title: Text(club.name),
                    subtitle: Text(
                        '${club.country?.name ?? 'Unknown country'} · ${club.sport?.name ?? 'Sport'}'),
                    onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                            builder: (_) => ClubDetailScreen(
                                clubId: club.id, api: widget.api))),
                  );
                },
              ),
            );
          },
        ),
      );
}

class ClubDetailScreen extends StatefulWidget {
  const ClubDetailScreen(
      {required this.clubId, super.key, this.api = const MobileApiService()});
  final String clubId;
  final MobileApiService api;
  @override
  State<ClubDetailScreen> createState() => _ClubDetailScreenState();
}

class _ClubDetailScreenState extends State<ClubDetailScreen> {
  int tab = 0;
  bool liveEnabled = true;

  @override
  void initState() {
    super.initState();
    _loadLiveFlag();
  }

  Future<void> _loadLiveFlag() async {
    final prefs = await SharedPreferences.getInstance();
    final config =
        await RemoteConfigService(apiBaseUrl: widget.api.baseUrl, prefs: prefs)
            .getNavigationConfig();
    if (mounted) {
      setState(() {
        liveEnabled = config.live;
        if (!liveEnabled && tab == 3) {
          tab = 1;
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: Text(widget.clubId)),
      body: MobileStateView<MobileClubDetail>(
          future: widget.api.getClub(widget.clubId),
          emptyText: 'Club not found.',
          builder: (context, detail) {
            final futures = [
              widget.api.getClubNews(widget.clubId),
              widget.api.getClubFixtures(widget.clubId),
              widget.api.getClubResults(widget.clubId),
              widget.api.getClubLive(widget.clubId)
            ];
            final tabs = <String>['News', 'Fixtures', 'Results'];
            if (liveEnabled) {
              tabs.add('Live');
            }
            return Column(children: [
              ListTile(
                  leading:
                      _Logo(url: detail.club.logoUrl, label: detail.club.name),
                  title: Text(detail.club.name),
                  subtitle: Text(
                      '${detail.club.country?.name ?? ''} · ${detail.club.sport?.name ?? ''}')),
              SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                      children: tabs
                          .asMap()
                          .entries
                          .map((entry) => Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 4),
                              child: ChoiceChip(
                                  label: Text(entry.value),
                                  selected: tab == entry.key,
                                  onSelected: (_) =>
                                      setState(() => tab = entry.key))))
                          .toList())),
              Expanded(
                  child: MobileStateView<dynamic>(
                      future: futures[tab],
                      emptyText: tab == 0
                          ? 'No news available for this club.'
                          : tab == 3 && liveEnabled
                              ? 'No live match right now.'
                              : 'No fixtures scheduled.',
                      builder: (context, value) => tab == 0
                          ? _NewsList(
                              articles: value as List<MobileNewsArticle>,
                              api: widget.api)
                          : _FixtureList(
                              fixtures: value as List<MobileFixture>,
                              api: widget.api)))
            ]);
          }));
}

class GlobalNewsScreen extends StatefulWidget {
  const GlobalNewsScreen({super.key, this.api = const MobileApiService()});
  final MobileApiService api;

  @override
  State<GlobalNewsScreen> createState() => _GlobalNewsScreenState();
}

class _GlobalNewsScreenState extends State<GlobalNewsScreen> {
  bool _followingMode = true;

  Future<List<MobileNewsArticle>> _loadNews() async {
    if (!_followingMode) {
      return widget.api.getNews();
    }

    final preferences = await _FollowPreferenceState.load();
    final followedSports = preferences['sports'] ?? const <String>{};
    final followedCompetitions =
        preferences['competitions'] ?? const <String>{};
    final followedTeams = preferences['teams'] ?? const <String>{};
    final catalogs = await Future.wait<dynamic>([
      widget.api.getSports(),
      widget.api.getCompetitions(),
      widget.api.getClubs(),
    ]);
    final sports = (catalogs[0] as List<MobileSport>)
        .where((sport) =>
            followedSports
                .contains(_FollowPreferenceState._normalize(sport.name)) ||
            followedSports
                .contains(_FollowPreferenceState._normalize(sport.slug)))
        .map((sport) => sport.id)
        .toList();
    final competitions = (catalogs[1] as List<MobileCompetition>)
        .where((competition) =>
            followedCompetitions.contains(
                _FollowPreferenceState._normalize(competition.name)) ||
            followedCompetitions
                .contains(_FollowPreferenceState._normalize(competition.slug)))
        .map((competition) => competition.id)
        .toList();
    final teams = (catalogs[2] as List<MobileClub>)
        .where((team) =>
            followedTeams
                .contains(_FollowPreferenceState._normalize(team.name)) ||
            followedTeams
                .contains(_FollowPreferenceState._normalize(team.shortName)) ||
            followedTeams
                .contains(_FollowPreferenceState._normalize(team.slug)))
        .map((team) => team.id)
        .toList();

    return widget.api.getNews(
      mode: 'following',
      sportIds: sports,
      competitionIds: competitions,
      teamIds: teams,
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
        title: const Text('News'),
        actions: [
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('Following')),
              ButtonSegment(value: false, label: Text('All')),
            ],
            selected: {_followingMode},
            onSelectionChanged: (selection) {
              setState(() {
                _followingMode = selection.first;
              });
            },
          ),
        ],
      ),
      body: MobileStateView<List<MobileNewsArticle>>(
          future: _loadNews(),
          emptyText: 'No news available.',
          builder: (context, articles) => RefreshIndicator(
              onRefresh: () async {
                setState(() {});
              },
              child: _NewsList(articles: articles, api: widget.api))));
}

class NewsDetailScreen extends StatefulWidget {
  const NewsDetailScreen(
      {required this.articleId,
      super.key,
      this.api = const MobileApiService()});
  final String articleId;
  final MobileApiService api;

  @override
  State<NewsDetailScreen> createState() => _NewsDetailScreenState();
}

class _NewsDetailScreenState extends State<NewsDetailScreen> {
  late Future<MobileNewsArticle> future;

  @override
  void initState() {
    super.initState();
    future = widget.api.getNewsArticle(widget.articleId);
  }

  void retry() =>
      setState(() => future = widget.api.getNewsArticle(widget.articleId));

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('News')),
        body: FutureBuilder<MobileNewsArticle>(
          future: future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('News article could not be loaded.'),
                const SizedBox(height: 12),
                FilledButton(onPressed: retry, child: const Text('Retry'))
              ]));
            }
            final article = snapshot.data;
            if (article == null || article.title.isEmpty) {
              return const Center(
                  child: Text('News article could not be loaded.'));
            }
            return ListView(padding: const EdgeInsets.all(16), children: [
              _NewsImage(url: article.imageUrl, height: 220),
              const SizedBox(height: 16),
              Text(article.title,
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                  '${article.sourceName ?? 'GiTO News'} · ${article.publishedAt ?? 'Date unavailable'}'),
              if (article.summary?.isNotEmpty == true) ...[
                const SizedBox(height: 16),
                Text(article.summary!,
                    style: Theme.of(context).textTheme.titleMedium)
              ],
              if (article.bodyBlocks.isNotEmpty) ...[
                const SizedBox(height: 16),
                ...article.bodyBlocks
                    .where((block) => block.enabled)
                    .map((block) => _NewsBodyBlockView(block: block)),
              ] else if (article.body?.isNotEmpty == true) ...[
                const SizedBox(height: 16),
                Text(article.body!,
                    style: Theme.of(context).textTheme.bodyLarge)
              ] else ...[
                const SizedBox(height: 16),
                const Text('Article content is unavailable.')
              ]
            ]);
          },
        ),
      );
}

class _NewsBodyBlockView extends StatelessWidget {
  const _NewsBodyBlockView({required this.block});
  final MobileNewsBodyBlock block;

  @override
  Widget build(BuildContext context) {
    final caption = block.caption?.isNotEmpty == true
        ? Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(block.caption!,
                style: Theme.of(context).textTheme.bodySmall))
        : const SizedBox.shrink();
    if (block.type == 'paragraph') {
      return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Text(block.text ?? '',
              style: Theme.of(context).textTheme.bodyLarge));
    }
    if (block.type == 'image' && block.url?.isNotEmpty == true) {
      return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(block.url!,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) =>
                        const _NewsInlineFallback(label: 'Image unavailable'))),
            caption
          ]));
    }
    if (block.type == 'video' && block.url?.isNotEmpty == true) {
      return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const _NewsInlineFallback(label: 'Video available from source'),
            SelectableText(block.url!),
            caption
          ]));
    }
    if (block.type == 'social' && block.url?.isNotEmpty == true) {
      return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.public),
                title: Text('View on ${block.platform ?? 'social media'}'),
                subtitle: Text(block.url!)),
            caption
          ]));
    }
    return const _NewsInlineFallback(label: 'Media unavailable');
  }
}

class _NewsInlineFallback extends StatelessWidget {
  const _NewsInlineFallback({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Text(label));
}

class FixtureDetailScreen extends StatelessWidget {
  const FixtureDetailScreen(
      {required this.fixtureId,
      super.key,
      this.api = const MobileApiService()});
  final String fixtureId;
  final MobileApiService api;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Fixture')),
      body: MobileStateView<MobileFixture>(
          future: api.getFixture(fixtureId),
          emptyText: 'Fixture not found.',
          builder: (context, fixture) =>
              ListView(padding: const EdgeInsets.all(16), children: [
                _FixtureTile(fixture: fixture),
                const SizedBox(height: 16),
                _MobileLineups(fixture: fixture),
                const SizedBox(height: 16),
                Text('Streams', style: Theme.of(context).textTheme.titleMedium),
                ...fixture.streams.map((stream) => ListTile(
                    title: Text(stream.channelName),
                    subtitle:
                        Text('${stream.providerName} · ${stream.healthStatus}'),
                    trailing: Text(stream.status)))
              ])));
}

        class _MobileLineups extends StatelessWidget {
          const _MobileLineups({required this.fixture});
          final MobileFixture fixture;
          @override
          Widget build(BuildContext context) {
            final lineups = fixture.lineups;
            if (lineups.isEmpty) return const Card(child: ListTile(title: Text('Lineups'), subtitle: Text('Lineups not available yet.')));
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Lineups', style: Theme.of(context).textTheme.titleLarge), ...lineups.map((lineup) => _MobileLineupCard(lineup: lineup, team: lineup.teamId == fixture.homeClub.id ? fixture.homeClub : fixture.awayClub))]);
          }
        }

        class _MobileLineupCard extends StatelessWidget {
          const _MobileLineupCard({required this.lineup, required this.team});
          final MobileLineup lineup;
          final MobileClub team;
          @override
          Widget build(BuildContext context) => Card(margin: const EdgeInsets.only(top: 12), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(team.name, style: Theme.of(context).textTheme.titleMedium), Text('${lineup.statusLabel} · ${lineup.formationName}'), if (lineup.status == 'possible' && lineup.starters.any((player) => player.availability != 'available')) const Text('Some players have limited availability.', style: TextStyle(fontSize: 12)), const SizedBox(height: 8), _MobileLineupPitch(lineup: lineup, logoUrl: team.logoUrl), const SizedBox(height: 8), const Text('Substitutes', style: TextStyle(fontWeight: FontWeight.bold)), ...lineup.substitutes.map((player) => ListTile(dense: true, leading: Text('${player.shirtNumber ?? '-'}'), title: Text(player.name), subtitle: Text(player.position ?? '')))])));
        }

        class _MobileLineupPitch extends StatelessWidget {
          const _MobileLineupPitch({required this.lineup, this.logoUrl});
          final MobileLineup lineup;
          final String? logoUrl;
          @override
          Widget build(BuildContext context) {
            final bySlot = {for (final player in lineup.starters) player.slotIndex ?? -1: player};
            return AspectRatio(aspectRatio: 1.25, child: Stack(children: [CustomPaint(size: Size.infinite, painter: const _FootballPitchPainter()), if (logoUrl?.isNotEmpty == true) Center(child: Opacity(opacity: .1, child: Image.network(logoUrl!, width: 130, height: 80, fit: BoxFit.contain))), for (var index = 0; index < lineup.positions.length; index++) Align(alignment: Alignment((((lineup.positions[index]['x'] as num?)?.toDouble() ?? 50) / 50) - 1, (((lineup.positions[index]['y'] as num?)?.toDouble() ?? 50) / 50) - 1), child: _MobileSlotMarker(player: bySlot[index], label: '${lineup.positions[index]['label'] ?? 'POS'}'))]));
          }
        }

        class _FootballPitchPainter extends CustomPainter {
          const _FootballPitchPainter();
          @override
          void paint(Canvas canvas, Size size) {
            final line = Paint()..color = Colors.white.withOpacity(.8)..style = PaintingStyle.stroke..strokeWidth = 1.2;
            canvas.drawRect((Offset.zero & size).deflate(2), line);
            canvas.drawLine(Offset(0, size.height / 2), Offset(size.width, size.height / 2), line);
            canvas.drawCircle(Offset(size.width / 2, size.height / 2), size.width * .16, line);
            canvas.drawCircle(Offset(size.width / 2, size.height / 2), 2, line);
            final boxWidth = size.width * .58;
            final boxHeight = size.height * .19;
            canvas.drawRect(Rect.fromLTWH((size.width - boxWidth) / 2, 2, boxWidth, boxHeight), line);
            canvas.drawRect(Rect.fromLTWH((size.width - boxWidth) / 2, size.height - boxHeight - 2, boxWidth, boxHeight), line);
            final sixWidth = size.width * .28;
            final sixHeight = size.height * .08;
            canvas.drawRect(Rect.fromLTWH((size.width - sixWidth) / 2, 2, sixWidth, sixHeight), line);
            canvas.drawRect(Rect.fromLTWH((size.width - sixWidth) / 2, size.height - sixHeight - 2, sixWidth, sixHeight), line);
            canvas.drawCircle(Offset(size.width / 2, boxHeight * .65), 2, line);
            canvas.drawCircle(Offset(size.width / 2, size.height - boxHeight * .65), 2, line);
            canvas.drawCircle(Offset(size.width / 2, 2 + boxHeight), size.width * .1, line);
            canvas.drawCircle(Offset(size.width / 2, size.height - boxHeight - 2), size.width * .1, line);
          }
          @override
          bool shouldRepaint(covariant _FootballPitchPainter oldDelegate) => false;
        }

        class _MobileSlotMarker extends StatelessWidget {
          const _MobileSlotMarker({required this.player, required this.label});
          final MobileLineupPlayer? player;
          final String label;
          @override
          Widget build(BuildContext context) => Container(padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3), color: Colors.white, child: player == null ? Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, color: Colors.black)) : Column(mainAxisSize: MainAxisSize.min, children: [ClipOval(child: player!.photoUrl?.isNotEmpty == true ? Image.network(player!.photoUrl!, width: 24, height: 24, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const _PlayerAvatarFallback()) : const _PlayerAvatarFallback()), Text('${player!.shirtNumber ?? '-'} ${player!.name}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 9, color: Colors.black))]));
        }

        class _PlayerAvatarFallback extends StatelessWidget {
          const _PlayerAvatarFallback();
          @override
          Widget build(BuildContext context) => Container(width: 24, height: 24, color: const Color(0xffd7e0e8), alignment: Alignment.center, child: const Icon(Icons.person, size: 16, color: Color(0xff52606d)));
        }

class _NewsList extends StatelessWidget {
  const _NewsList({required this.articles, required this.api});
  final List<MobileNewsArticle> articles;
  final MobileApiService api;
  @override
  Widget build(BuildContext context) => ListView.builder(
      itemCount: articles.length,
      itemBuilder: (context, index) {
        final article = articles[index];
        return Card(
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                  builder: (_) =>
                      NewsDetailScreen(articleId: article.id, api: api))),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _NewsImage(
                      url: article.imageUrl,
                      height: 180,
                      width: double.infinity),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          article.title,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${article.sourceName ?? 'GiTO News'} · ${article.publishedAt ?? 'Date unavailable'}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        if (article.summary?.isNotEmpty == true) ...[
                          const SizedBox(height: 12),
                          Text(
                            article.summary!,
                            style: Theme.of(context).textTheme.bodyMedium,
                          )
                        ]
                      ],
                    ),
                  )
                ],
              ),
            ));
      });
}

class _NewsImage extends StatelessWidget {
  const _NewsImage({required this.url, this.height = 160, this.width});
  final String? url;
  final double height;
  final double? width;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
        height: height,
        width: width,
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        alignment: Alignment.center,
        child: const Icon(Icons.article_outlined));
    if (url == null || url!.isEmpty) return placeholder;
    return Image.network(url!,
        height: height,
        width: width,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => placeholder,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : placeholder);
  }
}

class _FixtureList extends StatelessWidget {
  const _FixtureList({required this.fixtures, required this.api});
  final List<MobileFixture> fixtures;
  final MobileApiService api;
  @override
  Widget build(BuildContext context) => ListView.builder(
      itemCount: fixtures.length,
      itemBuilder: (context, index) => _FixtureTile(
          fixture: fixtures[index],
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => FixtureDetailScreen(
                  fixtureId: fixtures[index].id, api: api)))));
}

class _FixtureTile extends StatelessWidget {
  const _FixtureTile({required this.fixture, this.onTap});
  final MobileFixture fixture;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Card(
      child: ListTile(
          onTap: onTap,
          title: Text('${fixture.homeClub.name} vs ${fixture.awayClub.name}'),
          subtitle: Text(
              '${fixture.competition.name} · ${fixture.season?.name ?? 'Season unavailable'}\n${fixture.startsAt?.toLocal() ?? 'Time unavailable'} · ${fixture.venue ?? 'Venue unavailable'}'),
          trailing: Text(fixture.scoreLabel)));
}

class _Logo extends StatelessWidget {
  const _Logo({required this.url, required this.label});
  final String? url;
  final String label;
  @override
  Widget build(BuildContext context) => CircleAvatar(
      backgroundImage: url == null ? null : NetworkImage(url!),
      child: url == null ? Text(label.isEmpty ? '?' : label[0]) : null);
}
