import 'package:flutter/material.dart';

import '../models/mobile_models.dart';
import '../services/mobile_api_service.dart';

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

class ClubsScreen extends StatelessWidget {
  const ClubsScreen({super.key, this.api = const MobileApiService()});
  final MobileApiService api;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Clubs')),
        body: MobileStateView<List<MobileClub>>(
          future: api.getClubs(),
          emptyText: 'No clubs available.',
          builder: (context, clubs) => RefreshIndicator(
            onRefresh: api.getClubs,
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
                          builder: (_) =>
                              ClubDetailScreen(clubId: club.id, api: api))),
                );
              },
            ),
          ),
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
                      children: ['News', 'Fixtures', 'Results', 'Live']
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
                          : tab == 3
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

class GlobalNewsScreen extends StatelessWidget {
  const GlobalNewsScreen({super.key, this.api = const MobileApiService()});
  final MobileApiService api;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('News')),
      body: MobileStateView<List<MobileNewsArticle>>(
          future: api.getNews(),
          emptyText: 'No news available.',
          builder: (context, articles) => RefreshIndicator(
              onRefresh: api.getNews,
              child: _NewsList(articles: articles, api: api))));
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

  void retry() => setState(() => future = widget.api.getNewsArticle(widget.articleId));

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
                  child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                    const Text('News article could not be loaded.'),
                    const SizedBox(height: 12),
                    FilledButton(onPressed: retry, child: const Text('Retry'))
                  ]));
            }
            final article = snapshot.data;
            if (article == null || article.title.isEmpty) {
              return const Center(child: Text('News article could not be loaded.'));
            }
            return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _NewsImage(url: article.imageUrl, height: 220),
                  const SizedBox(height: 16),
                  Text(article.title,
                      style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  Text('${article.sourceName ?? 'GiTO News'} · ${article.publishedAt ?? 'Date unavailable'}'),
                  if (article.summary?.isNotEmpty == true) ...[
                    const SizedBox(height: 16),
                    Text(article.summary!,
                        style: Theme.of(context).textTheme.titleMedium)
                  ],
                  if (article.body?.isNotEmpty == true) ...[
                    const SizedBox(height: 16),
                    Text(article.body!, style: Theme.of(context).textTheme.bodyLarge)
                  ] else ...[
                    const SizedBox(height: 16),
                    const Text('Article content is unavailable.')
                  ]
                ]);
          },
        ),
      );
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
                Text('Streams', style: Theme.of(context).textTheme.titleMedium),
                ...fixture.streams.map((stream) => ListTile(
                    title: Text(stream.channelName),
                    subtitle:
                        Text('${stream.providerName} · ${stream.healthStatus}'),
                    trailing: Text(stream.status)))
              ])));
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
                  builder: (_) => NewsDetailScreen(articleId: article.id, api: api))),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _NewsImage(url: article.imageUrl, height: 180, width: double.infinity),
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
    return Image.network(url!, height: height, width: width, fit: BoxFit.cover,
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
