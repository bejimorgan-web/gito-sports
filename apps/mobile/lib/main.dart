import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

const appLogoUrl =
    'https://cdn.iconscout.com/icon/free/png-256/free-sports-4457831-3693644.png';
const appLogoAsset = 'assets/app_logo.png';

const apiBaseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://gito-sports.onrender.com',
);

const appInstallUrl =
    'https://gito.live/install'; // Update with your real Play Store or App Store link

void main() {
  runApp(const GitoLiveSportsApp());
}

class GitoLiveSportsApp extends StatelessWidget {
  const GitoLiveSportsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'GiTO Live Sports',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF20D37B),
          brightness: Brightness.dark,
          surface: const Color(0xFF101418),
        ),
        fontFamily: 'Roboto',
        scaffoldBackgroundColor: const Color(0xFF080B0E),
        useMaterial3: true,
      ),
      home: const LiveHomeScreen(),
    );
  }
}

enum FeedConnectionState { online, reconnecting, offline }

enum ViewerMatchState { live, startingSoon, ended, streamIssue, offline }

class WatermarkedPage extends StatelessWidget {
  const WatermarkedPage({
    required this.child,
    this.logoAsset,
    this.logoUrl,
    super.key,
  });

  final Widget child;
  final String? logoAsset;
  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    final asset = logoAsset?.isNotEmpty == true ? logoAsset : null;
    final url = logoUrl?.isNotEmpty == true ? logoUrl : null;

    if (asset == null && url == null) {
      return child;
    }

    return Stack(
      children: [
        Positioned.fill(
          child: Opacity(
            opacity: 0.08,
            child: asset != null
                ? Image.asset(
                    asset,
                    fit: BoxFit.contain,
                    alignment: Alignment.center,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  )
                : Image.network(
                    url!,
                    fit: BoxFit.contain,
                    alignment: Alignment.center,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  ),
          ),
        ),
        child,
      ],
    );
  }
}

class AppBrandHero extends StatelessWidget {
  const AppBrandHero({
    required this.title,
    required this.subtitle,
    this.logoAsset,
    this.logoUrl,
    this.trailing,
    super.key,
  });

  final String title;
  final String subtitle;
  final String? logoAsset;
  final String? logoUrl;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: const LinearGradient(
            colors: [Color(0xFF13251C), Color(0xFF101418)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: const Color(0xFF21332B)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: const Color(0xFF0F1612),
                  child: ClipOval(
                    child: logoAsset?.isNotEmpty == true
                        ? Image.asset(
                            logoAsset!,
                            width: 36,
                            height: 36,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.sports_soccer_rounded,
                              color: Color(0xFF20D37B),
                            ),
                          )
                        : (logoUrl?.isNotEmpty == true
                            ? Image.network(
                                logoUrl!,
                                width: 36,
                                height: 36,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => const Icon(
                                  Icons.sports_soccer_rounded,
                                  color: Color(0xFF20D37B),
                                ),
                              )
                            : const Icon(
                                Icons.sports_soccer_rounded,
                                color: Color(0xFF20D37B),
                              )),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                if (trailing != null) trailing!,
              ],
            ),
            const SizedBox(height: 26),
            Text(
              subtitle,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                    height: 1.05,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

enum PlaybackState { loading, connecting, playing, buffering, failure }

enum PlaybackScaleMode { fit, fill, zoom }

class LiveMatch {
  const LiveMatch({
    required this.id,
    required this.homeTeam,
    required this.awayTeam,
    required this.competition,
    required this.startsAt,
    required this.matchStatus,
    required this.streamStatus,
    required this.streamHealth,
    required this.playbackUrl,
    this.sportName,
    this.countryName,
    this.sportLogoUrl,
    this.countryLogoUrl,
    this.homeTeamLogoUrl,
    this.awayTeamLogoUrl,
    this.competitionLogoUrl,
  });

  final String id;
  final String homeTeam;
  final String awayTeam;
  final String competition;
  final String? sportName;
  final String? countryName;
  final DateTime startsAt;
  final String matchStatus;
  final String streamStatus;
  final String streamHealth;
  final String playbackUrl;
  final String? sportLogoUrl;
  final String? countryLogoUrl;
  final String? homeTeamLogoUrl;
  final String? awayTeamLogoUrl;
  final String? competitionLogoUrl;

  bool get hasPlayableStream =>
      matchStatus == 'published' &&
      streamStatus == 'active' &&
      streamHealth != 'failed';

  ViewerMatchState viewerState(FeedConnectionState connectionState) {
    if (connectionState == FeedConnectionState.offline) {
      return ViewerMatchState.offline;
    }

    if (!hasPlayableStream) {
      return ViewerMatchState.streamIssue;
    }

    final now = DateTime.now();

    if (startsAt.isAfter(now) && startsAt.difference(now).inMinutes <= 30) {
      return ViewerMatchState.startingSoon;
    }

    if (matchStatus == 'ended' || matchStatus == 'cancelled') {
      return ViewerMatchState.ended;
    }

    return ViewerMatchState.live;
  }

  factory LiveMatch.fromJson(Map<String, Object?> json) {
    final match = json['match'] as Map<String, Object?>? ?? {};
    final stream = json['stream'] as Map<String, Object?>? ?? {};
    final channel = json['channel'] as Map<String, Object?>?;
    final fallbackId = (stream['id'] ?? match['id'] ?? 'match').toString();

    final homeTeamName = json['homeTeamName'] ?? match['homeTeamName'];
    final awayTeamName = json['awayTeamName'] ?? match['awayTeamName'];
    final competitionName = json['competitionName'] ?? match['competitionName'];
    final playbackUrl = _normalizeMediaUrl(
      json['playbackUrl'] ?? stream['url'] ?? match['url'] ?? channel?['url'],
    );
    final startsAtSource = match['startsAt'] ?? json['startsAt'];
    final matchStatusSource =
        match['status'] ?? json['status'] ?? json['matchStatus'];
    final streamStatusSource = stream['status'] ?? json['streamStatus'];
    final streamHealthSource = stream['healthStatus'] ?? json['streamHealth'];

    return LiveMatch(
      id: fallbackId,
      homeTeam: (homeTeamName ?? _displayLabel('Home', match['homeTeamId']))
          .toString(),
      awayTeam: (awayTeamName ?? _displayLabel('Away', match['awayTeamId']))
          .toString(),
      competition: (competitionName ??
              _displayLabel('Competition', match['competitionId']))
          .toString(),
      startsAt:
          DateTime.tryParse(startsAtSource?.toString() ?? '') ?? DateTime.now(),
      matchStatus: (matchStatusSource ?? 'published').toString(),
      streamStatus: (streamStatusSource ?? 'active').toString(),
      streamHealth: (streamHealthSource ?? 'unknown').toString(),
      playbackUrl: playbackUrl ?? '',
      sportName: (json['sportName'] ??
              match['sportName'] ??
              _displayLabel('Sport', match['sportId']))
          .toString(),
      countryName: (json['countryName'] ??
              match['countryName'] ??
              _displayLabel('Country', match['countryId']))
          .toString(),
      homeTeamLogoUrl: _normalizeMediaUrl(
          json['homeTeamLogoUrl'] ?? match['homeTeamLogoUrl']),
      awayTeamLogoUrl: _normalizeMediaUrl(
          json['awayTeamLogoUrl'] ?? match['awayTeamLogoUrl']),
      competitionLogoUrl: _normalizeMediaUrl(
          json['competitionLogoUrl'] ?? match['competitionLogoUrl']),
      sportLogoUrl:
          _normalizeMediaUrl(json['sportLogoUrl'] ?? match['sportLogoUrl']),
      countryLogoUrl:
          _normalizeMediaUrl(json['countryLogoUrl'] ?? match['countryLogoUrl']),
    );
  }
}

String _displayLabel(String prefix, Object? value) {
  final raw = (value ?? '').toString();

  if (raw.isEmpty) {
    return prefix;
  }

  final short =
      raw.length > 8 ? raw.substring(0, 8).toUpperCase() : raw.toUpperCase();
  return '$prefix $short';
}

String? _normalizeMediaUrl(Object? value) {
  final raw = value?.toString().trim();
  if (raw == null || raw.isEmpty) {
    return null;
  }

  if (raw.startsWith('/')) {
    return '$apiBaseUrl$raw';
  }

  return raw;
}

class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _initialized = false;
  Future<void>? _initializeTask;

  Future<void> initialize() {
    if (_initialized) {
      return Future.value();
    }
    return _initializeTask ??= _initializeInternal();
  }

  Future<void> _initializeInternal() async {
    tz.initializeTimeZones();

    const androidSettings =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    await _plugin.initialize(
      const InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
      ),
    );

    await _requestPermissions();
    _initialized = true;
  }

  Future<void> _requestPermissions() async {
    final androidImplementation = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    try {
      await androidImplementation?.requestNotificationsPermission();
    } on PlatformException catch (e) {
      if (e.code != 'permissionRequestInProgress') {
        rethrow;
      }
    }

    final iosImplementation = _plugin.resolvePlatformSpecificImplementation<
        IOSFlutterLocalNotificationsPlugin>();
    try {
      await iosImplementation?.requestPermissions(
        alert: true,
        badge: true,
        sound: true,
      );
    } on PlatformException catch (e) {
      if (e.code != 'permissionRequestInProgress') {
        rethrow;
      }
    }
  }

  Future<void> showAssignmentNotification(List<LiveMatch> matches) async {
    if (matches.isEmpty) {
      return;
    }

    await initialize();

    final body = matches.length == 1
        ? '${matches.first.homeTeam} vs ${matches.first.awayTeam} at ${_formatKickoff(matches.first.startsAt)}'
        : '${matches.length} matches are assigned for today.';

    await _plugin.show(
      999999,
      'Assigned match${matches.length == 1 ? '' : 'es'} today',
      body,
      _notificationDetails(),
    );
  }

  Future<void> updateForMatches(List<LiveMatch> matches) async {
    await initialize();
    await _plugin.cancelAll();

    final now = DateTime.now();
    for (final match in matches) {
      final matchTime = match.startsAt.toLocal();
      if (!matchTime.isAfter(now)) {
        continue;
      }

      final reminderTime = matchTime.subtract(const Duration(minutes: 10));
      if (reminderTime.isAfter(now)) {
        await _scheduleNotification(
          _reminderId(match.id),
          'Kickoff in 10 minutes',
          '${match.homeTeam} vs ${match.awayTeam}',
          reminderTime,
        );
      }

      await _scheduleNotification(
        _kickoffId(match.id),
        'Kickoff now',
        '${match.homeTeam} vs ${match.awayTeam}',
        matchTime,
      );
    }
  }

  NotificationDetails _notificationDetails() {
    return const NotificationDetails(
      android: AndroidNotificationDetails(
        'gito_live_sports',
        'GiTO Live Sports',
        channelDescription: 'Match reminders and kickoff alerts',
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: DarwinNotificationDetails(),
    );
  }

  Future<void> _scheduleNotification(
    int id,
    String title,
    String body,
    DateTime scheduledDate,
  ) async {
    await _plugin.zonedSchedule(
      id,
      title,
      body,
      tz.TZDateTime.from(scheduledDate, tz.local),
      _notificationDetails(),
      androidAllowWhileIdle: true,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      matchDateTimeComponents: DateTimeComponents.dateAndTime,
    );
  }

  int _kickoffId(String matchId) => matchId.hashCode & 0x7FFFFFFF;

  int _reminderId(String matchId) =>
      (matchId.hashCode ^ 0xA5A5A5A5) & 0x7FFFFFFF;
}

class MobileFeedService {
  const MobileFeedService();

  Future<List<LiveMatch>> fetchLiveMatches() async {
    final uri = Uri.parse('$apiBaseUrl/mobile/matches/live');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);

    try {
      final request = await client.getUrl(uri);
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      final response =
          await request.close().timeout(const Duration(seconds: 6));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const SocketException('Live feed unavailable');
      }

      final body = await response.transform(utf8.decoder).join();
      final decoded = jsonDecode(body) as Map<String, Object?>;
      final data = decoded['data'] as List<Object?>? ?? [];

      return data
          .whereType<Map<String, Object?>>()
          .map(LiveMatch.fromJson)
          .toList(growable: false);
    } finally {
      client.close(force: true);
    }
  }
}

class ScoreMatch {
  const ScoreMatch({
    required this.id,
    required this.competitionName,
    required this.homeTeamName,
    required this.awayTeamName,
    required this.status,
    this.utcDate,
    this.minute,
    this.homeScore,
    this.awayScore,
    this.competitionLogoUrl,
    this.homeTeamLogoUrl,
    this.awayTeamLogoUrl,
  });

  final String id;
  final String competitionName;
  final String homeTeamName;
  final String awayTeamName;
  final String status;
  final DateTime? utcDate;
  final int? minute;
  final int? homeScore;
  final int? awayScore;
  final String? competitionLogoUrl;
  final String? homeTeamLogoUrl;
  final String? awayTeamLogoUrl;

  String get scoreLabel {
    if (homeScore == null || awayScore == null) {
      return '-';
    }

    return '$homeScore - $awayScore';
  }

  String get minuteLabel {
    if (minute != null) {
      return "$minute'";
    }

    return switch (status) {
      'TIMED' ||
      'SCHEDULED' =>
        'KO ${utcDate != null ? _formatKickoff(utcDate!) : 'TBD'}',
      'PAUSED' => 'HT',
      'FINISHED' => 'FT',
      _ => '--',
    };
  }

  factory ScoreMatch.fromJson(Map<String, Object?> json) {
    final competition = _jsonMap(json['competition']);
    final homeTeam = _jsonMap(json['homeTeam']);
    final awayTeam = _jsonMap(json['awayTeam']);
    final score = _jsonMap(json['score']);

    return ScoreMatch(
      id: (json['id'] ?? 'match').toString(),
      competitionName: (competition['name'] ?? 'Competition').toString(),
      homeTeamName: (homeTeam['name'] ?? 'Home').toString(),
      awayTeamName: (awayTeam['name'] ?? 'Away').toString(),
      status: (json['status'] ?? 'UNKNOWN').toString(),
      minute: _jsonInt(json['minute']),
      homeScore: _jsonInt(score['home']),
      awayScore: _jsonInt(score['away']),
      utcDate: DateTime.tryParse(json['utcDate']?.toString() ?? ''),
      competitionLogoUrl: _normalizeMediaUrl(competition['logoUrl']),
      homeTeamLogoUrl: _normalizeMediaUrl(homeTeam['logoUrl']),
      awayTeamLogoUrl: _normalizeMediaUrl(awayTeam['logoUrl']),
    );
  }
}

Map<String, Object?> _jsonMap(Object? value) {
  return value is Map ? Map<String, Object?>.from(value) : <String, Object?>{};
}

int? _jsonInt(Object? value) {
  if (value is int) {
    return value;
  }

  if (value is num) {
    return value.toInt();
  }

  return int.tryParse(value?.toString() ?? '');
}

class ScoreFeedResult {
  const ScoreFeedResult({
    required this.matches,
    required this.source,
    this.ageMs,
    this.cachedAt,
  });

  final List<ScoreMatch> matches;
  final String source;
  final int? ageMs;
  final String? cachedAt;
}

class ScoreService {
  const ScoreService();

  Future<ScoreFeedResult> fetchLiveScores() async {
    final decoded = await _getJson('$apiBaseUrl/scores/live');
    final data = decoded['data'] as List<Object?>? ?? [];
    final meta = decoded['meta'] as Map<String, Object?>?;
    final source = meta?['source'] as String? ?? 'cache';
    final ageMs = meta?['ageMs'] is int ? meta!['ageMs'] as int : null;
    final cachedAt = meta?['cachedAt'] as String?;

    return ScoreFeedResult(
      matches: data
          .whereType<Map<String, Object?>>()
          .map(ScoreMatch.fromJson)
          .toList(growable: false),
      source: source,
      ageMs: ageMs,
      cachedAt: cachedAt,
    );
  }

  Future<ScoreMatch> fetchMatch(String matchId) async {
    final decoded = await _getJson('$apiBaseUrl/scores/match/$matchId');
    final data = decoded['data'];

    if (data is! Map<String, Object?>) {
      throw const FormatException('Score match payload is invalid');
    }

    return ScoreMatch.fromJson(data);
  }

  Future<Map<String, Object?>> _getJson(String url) async {
    final uri = Uri.parse(url);
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);

    try {
      final request = await client.getUrl(uri);
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      final response =
          await request.close().timeout(const Duration(seconds: 6));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const SocketException('Score feed unavailable');
      }

      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, Object?>;
    } finally {
      client.close(force: true);
    }
  }
}

class LiveHomeScreen extends StatefulWidget {
  const LiveHomeScreen({super.key});

  @override
  State<LiveHomeScreen> createState() => _LiveHomeScreenState();
}

class _LiveHomeScreenState extends State<LiveHomeScreen> {
  final _feedService = const MobileFeedService();
  final _matches = <LiveMatch>[];
  final _knownMatchIds = <String>{};
  FeedConnectionState _connectionState = FeedConnectionState.reconnecting;
  Timer? _refreshTimer;
  int _activeTab = 0;
  bool _firstLoad = true;

  @override
  void initState() {
    super.initState();
    unawaited(NotificationService.instance.initialize());
    unawaited(_refreshFeed());
    _refreshTimer =
        Timer.periodic(const Duration(seconds: 5), (_) => _refreshFeed());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshFeed() async {
    try {
      final nextMatches = await _feedService.fetchLiveMatches();

      if (!mounted) {
        return;
      }

      final currentMatchIds = nextMatches.map((match) => match.id).toSet();
      final newlyAssignedToday = nextMatches.where((match) {
        return !_knownMatchIds.contains(match.id) && _isToday(match.startsAt);
      }).toList();

      setState(() {
        _matches
          ..clear()
          ..addAll(nextMatches);
        _knownMatchIds
          ..clear()
          ..addAll(currentMatchIds);
        _connectionState = FeedConnectionState.online;
        _firstLoad = false;
      });

      if (newlyAssignedToday.isNotEmpty) {
        unawaited(
          NotificationService.instance
              .showAssignmentNotification(newlyAssignedToday),
        );
      }

      unawaited(NotificationService.instance.updateForMatches(nextMatches));
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _connectionState = _matches.isEmpty
            ? FeedConnectionState.offline
            : FeedConnectionState.reconnecting;
        _firstLoad = false;
      });
    }
  }

  bool _isToday(DateTime dateTime) {
    final local = dateTime.toLocal();
    final now = DateTime.now();
    return local.year == now.year &&
        local.month == now.month &&
        local.day == now.day;
  }

  void _shareApp() {
    Share.share(
      'GiTO Live Sports is installed on my phone — watch live games, get kickoff reminders, and join the match feed. '
      'Install it here: $appInstallUrl',
      subject: 'Install GiTO Live Sports',
    );
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      const LiveScoresScreen(),
      SportsScreen(matches: List.unmodifiable(_matches)),
      LiveTab(
        connectionState: _connectionState,
        firstLoad: _firstLoad,
        matches: List.unmodifiable(_matches),
        onRefresh: _refreshFeed,
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('GiTO Live Sports'),
        actions: [
          IconButton(
            icon: const Icon(Icons.share_rounded),
            tooltip: 'Share app',
            onPressed: _shareApp,
          ),
        ],
      ),
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 180),
        child: screens[_activeTab],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _activeTab,
        backgroundColor: const Color(0xFF101418),
        indicatorColor: const Color(0x2E20D37B),
        onDestinationSelected: (index) => setState(() => _activeTab = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.scoreboard_rounded),
            label: 'Live Scores',
          ),
          NavigationDestination(
            icon: Icon(Icons.sports_soccer_rounded),
            label: 'Sports',
          ),
          NavigationDestination(
            icon: Icon(Icons.live_tv_rounded),
            label: 'Live',
          ),
        ],
      ),
    );
  }
}

class LiveScoresScreen extends StatefulWidget {
  const LiveScoresScreen({super.key});

  @override
  State<LiveScoresScreen> createState() => _LiveScoresScreenState();
}

class _LiveScoresScreenState extends State<LiveScoresScreen> {
  final _scoreService = const ScoreService();
  final _scores = <ScoreMatch>[];
  Timer? _refreshTimer;
  FeedConnectionState _connectionState = FeedConnectionState.reconnecting;
  bool _firstLoad = true;

  @override
  void initState() {
    super.initState();
    unawaited(_refreshScores());
    _refreshTimer =
        Timer.periodic(const Duration(seconds: 20), (_) => _refreshScores());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshScores() async {
    try {
      final result = await _scoreService.fetchLiveScores();
      final nextScores = result.matches;

      if (!mounted) {
        return;
      }

      setState(() {
        _scores
          ..clear()
          ..addAll(nextScores);
        _connectionState = result.source == 'stale_cache'
            ? FeedConnectionState.reconnecting
            : FeedConnectionState.online;
        _firstLoad = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _connectionState = _scores.isEmpty
            ? FeedConnectionState.offline
            : FeedConnectionState.reconnecting;
        _firstLoad = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return WatermarkedPage(
      logoAsset: appLogoAsset,
      child: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refreshScores,
          child: CustomScrollView(
            key: const PageStorageKey('live-scores'),
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: AppBrandHero(
                  title: 'Live Scores',
                  subtitle: 'Live scores as they happen.',
                  logoAsset: appLogoAsset,
                  trailing: ConnectionDot(state: _connectionState),
                ),
              ),
              if (!_firstLoad && _connectionState != FeedConnectionState.online)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                    child: ElevatedButton(
                      onPressed: _refreshScores,
                      child: const Text('Retry live scores'),
                    ),
                  ),
                ),
              if (_firstLoad)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_scores.isEmpty)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: EmptyPanel(
                      text: 'No Live Scores available',
                    ),
                  ),
                )
              else
                SliverList.separated(
                  itemCount: _scores.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final score = _scores[index];
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      child: ScoreMatchCard(match: score),
                    );
                  },
                ),
              const SliverToBoxAdapter(child: SizedBox(height: 18)),
            ],
          ),
        ),
      ),
    );
  }
}

class ScoreMatchCard extends StatelessWidget {
  const ScoreMatchCard({required this.match, super.key});

  final ScoreMatch match;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => MatchScoreDetailsScreen(matchId: match.id),
            ),
          );
        },
        child: Ink(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF101418),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFF20262B)),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  TeamLogo(
                    name: match.competitionName,
                    size: 28,
                    logoUrl: match.competitionLogoUrl,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      match.competitionName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFFAAB4AE),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  ScoreStatusPill(status: match.status),
                ],
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: ScoreTeamBlock(
                      name: match.homeTeamName,
                      logoUrl: match.homeTeamLogoUrl,
                    ),
                  ),
                  SizedBox(
                    width: 88,
                    child: Column(
                      children: [
                        Text(
                          match.scoreLabel,
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          match.minuteLabel,
                          style: const TextStyle(
                            color: Color(0xFF20D37B),
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ScoreTeamBlock(
                      name: match.awayTeamName,
                      logoUrl: match.awayTeamLogoUrl,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class MatchScoreDetailsScreen extends StatelessWidget {
  const MatchScoreDetailsScreen({required this.matchId, super.key});

  final String matchId;

  @override
  Widget build(BuildContext context) {
    const scoreService = ScoreService();

    return Scaffold(
      appBar: AppBar(title: const Text('Score Details')),
      body: SafeArea(
        child: FutureBuilder<ScoreMatch>(
          future: scoreService.fetchMatch(matchId),
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }

            if (snapshot.hasError || !snapshot.hasData) {
              return const Center(
                child: EmptyPanel(text: 'Score details are unavailable.'),
              );
            }

            final match = snapshot.data!;

            return ListView(
              padding: const EdgeInsets.all(18),
              children: [
                Row(
                  children: [
                    TeamLogo(
                      name: match.competitionName,
                      size: 46,
                      logoUrl: match.competitionLogoUrl,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        match.competitionName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                    ),
                    ScoreStatusPill(status: match.status),
                  ],
                ),
                const SizedBox(height: 30),
                Scoreboard(match: match),
                const SizedBox(height: 26),
                DetailRow(
                  icon: Icons.timer_rounded,
                  label: 'Minute',
                  value: match.minuteLabel,
                ),
                DetailRow(
                  icon: Icons.flag_rounded,
                  label: 'Status',
                  value: _scoreStatusLabel(match.status),
                ),
                DetailRow(
                  icon: Icons.schedule_rounded,
                  label: 'Kickoff',
                  value: match.utcDate != null
                      ? _formatKickoff(match.utcDate!)
                      : 'TBD',
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class Scoreboard extends StatelessWidget {
  const Scoreboard({required this.match, super.key});

  final ScoreMatch match;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF101418),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF20262B)),
      ),
      child: Row(
        children: [
          Expanded(
            child: ScoreTeamBlock(
              name: match.homeTeamName,
              logoUrl: match.homeTeamLogoUrl,
              large: true,
            ),
          ),
          SizedBox(
            width: 110,
            child: Column(
              children: [
                Text(
                  match.scoreLabel,
                  textAlign: TextAlign.center,
                  style: Theme.of(context)
                      .textTheme
                      .headlineMedium
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                Text(
                  match.minuteLabel,
                  style: const TextStyle(
                    color: Color(0xFF20D37B),
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ScoreTeamBlock(
              name: match.awayTeamName,
              logoUrl: match.awayTeamLogoUrl,
              large: true,
            ),
          ),
        ],
      ),
    );
  }
}

class ScoreTeamBlock extends StatelessWidget {
  const ScoreTeamBlock({
    required this.name,
    this.logoUrl,
    this.large = false,
    super.key,
  });

  final String name;
  final String? logoUrl;
  final bool large;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TeamLogo(name: name, size: large ? 62 : 44, logoUrl: logoUrl),
        const SizedBox(height: 10),
        Text(
          name,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontWeight: FontWeight.w900,
            fontSize: large ? 15 : 13,
          ),
        ),
      ],
    );
  }
}

class ScoreStatusPill extends StatelessWidget {
  const ScoreStatusPill({required this.status, super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = status == 'IN_PLAY'
        ? const Color(0xFF20D37B)
        : status == 'PAUSED'
            ? const Color(0xFFFFC857)
            : const Color(0xFFAAB4AE);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withAlpha(41),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withAlpha(163)),
      ),
      child: Text(
        _scoreStatusLabel(status),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w900,
          letterSpacing: 0,
        ),
      ),
    );
  }
}

class SportsScreen extends StatelessWidget {
  const SportsScreen({required this.matches, super.key});

  final List<LiveMatch> matches;

  @override
  Widget build(BuildContext context) {
    final sports = <String, Map<String, List<LiveMatch>>>{};
    final sportLogos = <String, String?>{};
    final countryLogos = <String, String?>{};

    for (final match in matches) {
      final sportName =
          match.sportName?.isNotEmpty == true ? match.sportName! : 'All Sports';
      final countryName =
          match.countryName?.isNotEmpty == true ? match.countryName! : 'Global';

      sportLogos[sportName] = sportLogos[sportName] ?? match.sportLogoUrl;
      countryLogos[countryName] =
          countryLogos[countryName] ?? match.countryLogoUrl;

      final countries = sports.putIfAbsent(sportName, () => {});
      final matchesForCountry = countries.putIfAbsent(countryName, () => []);
      matchesForCountry.add(match);
    }

    return WatermarkedPage(
      logoAsset: appLogoAsset,
      child: SafeArea(
        child: ListView(
          key: const PageStorageKey('sports-browser'),
          padding: const EdgeInsets.all(18),
          children: [
            const AppBrandHero(
              title: 'Sports',
              subtitle: 'Browse all sports by country.',
              logoAsset: appLogoAsset,
            ),
            const SizedBox(height: 18),
            if (sports.isEmpty)
              const EmptyPanel(text: 'No sports are available right now.')
            else
              ...sports.entries.map((entry) {
                final sportName = entry.key;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Card(
                    color: const Color(0xFF101418),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(18),
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => SportCountriesScreen(
                              sportName: sportName,
                              sportLogoUrl: sportLogos[sportName],
                              countryMatches: entry.value,
                              countryLogos: countryLogos,
                            ),
                          ),
                        );
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 18, vertical: 20),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 34,
                              backgroundColor: const Color(0xFF0F1612),
                              backgroundImage:
                                  sportLogos[sportName]?.isNotEmpty == true
                                      ? NetworkImage(sportLogos[sportName]!)
                                      : null,
                              child: sportLogos[sportName]?.isNotEmpty != true
                                  ? Text(
                                      sportName.substring(0, 1).toUpperCase())
                                  : null,
                            ),
                            const SizedBox(width: 18),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(sportName,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge
                                          ?.copyWith(
                                            fontWeight: FontWeight.w900,
                                          )),
                                  const SizedBox(height: 8),
                                  Text(
                                    '${entry.value.length} country${entry.value.length == 1 ? '' : 'ies'}',
                                    style: const TextStyle(
                                        color: Color(0xFFAAB4AE)),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(Icons.chevron_right_rounded,
                                color: Color(0xFF20D37B)),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

class SportCountriesScreen extends StatelessWidget {
  const SportCountriesScreen({
    required this.sportName,
    required this.sportLogoUrl,
    required this.countryMatches,
    required this.countryLogos,
    super.key,
  });

  final String sportName;
  final String? sportLogoUrl;
  final Map<String, List<LiveMatch>> countryMatches;
  final Map<String, String?> countryLogos;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(sportName)),
      body: WatermarkedPage(
        logoUrl: sportLogoUrl,
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              if (sportLogoUrl?.isNotEmpty == true)
                Center(
                  child: CircleAvatar(
                    radius: 42,
                    backgroundColor: const Color(0xFF0F1612),
                    backgroundImage: NetworkImage(sportLogoUrl!),
                  ),
                ),
              if (sportLogoUrl?.isNotEmpty == true) const SizedBox(height: 14),
              Text('Countries',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              const Text(
                'Choose a country to see competitions in this sport.',
                style: TextStyle(color: Color(0xFFAAB4AE)),
              ),
              const SizedBox(height: 18),
              ...countryMatches.entries.map((entry) {
                final countryName = entry.key;
                final matches = entry.value;
                final countryLogoUrl =
                    matches.isNotEmpty ? matches.first.countryLogoUrl : null;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Card(
                    color: const Color(0xFF101418),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(18),
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => CountryCompetitionsScreen(
                              sportName: sportName,
                              countryName: countryName,
                              competitionMatches: matches,
                              countryLogoUrl: countryLogoUrl,
                            ),
                          ),
                        );
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 18, vertical: 20),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 30,
                              backgroundColor: const Color(0xFF0F1612),
                              backgroundImage:
                                  countryLogos[countryName]?.isNotEmpty == true
                                      ? NetworkImage(countryLogos[countryName]!)
                                      : null,
                              child: countryLogos[countryName]?.isNotEmpty !=
                                      true
                                  ? Text(
                                      countryName.substring(0, 1).toUpperCase())
                                  : null,
                            ),
                            const SizedBox(width: 18),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(countryName,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge
                                          ?.copyWith(
                                            fontWeight: FontWeight.w900,
                                          )),
                                  const SizedBox(height: 8),
                                  Text(
                                    '${matches.length} assigned match${matches.length == 1 ? '' : 'es'}',
                                    style: const TextStyle(
                                        color: Color(0xFFAAB4AE)),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(Icons.chevron_right_rounded,
                                color: Color(0xFF20D37B)),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ],
          ),
        ),
      ),
    );
  }
}

class CountryCompetitionsScreen extends StatelessWidget {
  const CountryCompetitionsScreen({
    required this.sportName,
    required this.countryName,
    required this.competitionMatches,
    this.countryLogoUrl,
    super.key,
  });

  final String sportName;
  final String countryName;
  final List<LiveMatch> competitionMatches;
  final String? countryLogoUrl;

  @override
  Widget build(BuildContext context) {
    final competitions = <String, List<LiveMatch>>{};

    for (final match in competitionMatches) {
      competitions.putIfAbsent(match.competition, () => []).add(match);
    }

    return Scaffold(
      appBar: AppBar(title: Text('$sportName · $countryName')),
      body: WatermarkedPage(
        logoUrl: countryLogoUrl,
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Text('Competitions',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              const Text(
                'Select a competition to see all assigned matches.',
                style: TextStyle(color: Color(0xFFAAB4AE)),
              ),
              const SizedBox(height: 18),
              if (competitions.isEmpty)
                const EmptyPanel(
                    text: 'No competitions found for this country.')
              else
                ...competitions.entries.map((entry) {
                  final competitionName = entry.key;
                  final matches = entry.value;
                  final logoUrl = matches.first.competitionLogoUrl;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Card(
                      color: const Color(0xFF101418),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(18),
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => CompetitionMatchesScreen(
                                competitionName: competitionName,
                                matches: matches,
                                competitionLogoUrl: logoUrl,
                              ),
                            ),
                          );
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 18, vertical: 20),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 34,
                                backgroundColor: const Color(0xFF0F1612),
                                backgroundImage: logoUrl?.isNotEmpty == true
                                    ? NetworkImage(logoUrl!)
                                    : null,
                                child: logoUrl?.isNotEmpty != true
                                    ? Text(competitionName
                                        .substring(0, 1)
                                        .toUpperCase())
                                    : null,
                              ),
                              const SizedBox(width: 18),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(competitionName,
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleLarge
                                            ?.copyWith(
                                              fontWeight: FontWeight.w900,
                                            )),
                                    const SizedBox(height: 8),
                                    Text(
                                      '${matches.length} match${matches.length == 1 ? '' : 'es'}',
                                      style: const TextStyle(
                                          color: Color(0xFFAAB4AE)),
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(Icons.chevron_right_rounded,
                                  color: Color(0xFF20D37B)),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                }),
            ],
          ),
        ),
      ),
    );
  }
}

class CompetitionMatchesScreen extends StatelessWidget {
  const CompetitionMatchesScreen({
    required this.competitionName,
    required this.matches,
    this.competitionLogoUrl,
    super.key,
  });

  final String competitionName;
  final List<LiveMatch> matches;
  final String? competitionLogoUrl;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(competitionName)),
      body: WatermarkedPage(
        logoUrl: competitionLogoUrl,
        child: SafeArea(
          child: ListView.separated(
            key: const PageStorageKey('competition-matches'),
            padding: const EdgeInsets.all(18),
            itemCount: matches.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final match = matches[index];
              return Card(
                color: const Color(0xFF101418),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => MatchDetailsScreen(
                          match: match,
                          state: match.viewerState(FeedConnectionState.online),
                        ),
                      ),
                    );
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _formatKickoff(match.startsAt),
                                style: const TextStyle(
                                  color: Color(0xFFAAB4AE),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const Icon(
                              Icons.chevron_right_rounded,
                              color: Color(0xFF20D37B),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        MatchupPreview(match: match),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class LiveTab extends StatelessWidget {
  const LiveTab({
    required this.connectionState,
    required this.firstLoad,
    required this.matches,
    required this.onRefresh,
    super.key,
  });

  final FeedConnectionState connectionState;
  final bool firstLoad;
  final List<LiveMatch> matches;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final liveMatches = matches
        .where((match) =>
            match.viewerState(connectionState) == ViewerMatchState.live)
        .toList(growable: false);
    final sports = <String, List<LiveMatch>>{};

    for (final match in liveMatches) {
      final sportName =
          match.sportName?.isNotEmpty == true ? match.sportName! : 'Live';
      sports.putIfAbsent(sportName, () => []).add(match);
    }

    return WatermarkedPage(
      logoAsset: appLogoAsset,
      child: SafeArea(
        child: RefreshIndicator(
          onRefresh: onRefresh,
          child: CustomScrollView(
            key: const PageStorageKey('live-feed'),
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: AppBrandHero(
                  title: 'GiTO Live Sports',
                  subtitle: 'Watch live sports as it happens.',
                  logoAsset: appLogoAsset,
                  trailing: ConnectionDot(state: connectionState),
                ),
              ),
              if (firstLoad)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(child: CircularProgressIndicator()),
                )
              else ...[
                FeedStatusBanner(
                  connectionState: connectionState,
                  hasCachedMatches: matches.isNotEmpty,
                ),
                if (liveMatches.isEmpty)
                  const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(
                      child:
                          EmptyPanel(text: 'No matches have kicked off yet.'),
                    ),
                  )
                else
                  ...sports.entries.expand((entry) => [
                        SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(18, 18, 18, 8),
                            child: Text(entry.key,
                                style: Theme.of(context)
                                    .textTheme
                                    .titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w900)),
                          ),
                        ),
                        SliverList.separated(
                          itemCount: entry.value.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 10),
                          itemBuilder: (context, index) {
                            final match = entry.value[index];
                            return Padding(
                              padding: const EdgeInsets.fromLTRB(18, 0, 18, 0),
                              child: LiveMatchCard(
                                match: match,
                                state: ViewerMatchState.live,
                              ),
                            );
                          },
                        ),
                      ]),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class HeaderHero extends StatelessWidget {
  const HeaderHero({required this.connectionState, super.key});

  final FeedConnectionState connectionState;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: const LinearGradient(
            colors: [Color(0xFF13251C), Color(0xFF101418)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: const Color(0xFF21332B)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.sports_soccer_rounded,
                    color: Color(0xFF20D37B)),
                const SizedBox(width: 10),
                Text(
                  'GiTO Live Sports',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const Spacer(),
                ConnectionDot(state: connectionState),
              ],
            ),
            const SizedBox(height: 26),
            Text(
              'Watch live sports as it happens.',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                    height: 1.05,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class FeedStatusBanner extends StatelessWidget {
  const FeedStatusBanner({
    required this.connectionState,
    required this.hasCachedMatches,
    super.key,
  });

  final FeedConnectionState connectionState;
  final bool hasCachedMatches;

  @override
  Widget build(BuildContext context) {
    if (connectionState == FeedConnectionState.online) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    final text =
        connectionState == FeedConnectionState.reconnecting && hasCachedMatches
            ? 'Reconnecting. Showing the last live feed.'
            : 'Live feed offline. Pull to retry.';

    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 0, 18, 8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF2A2012),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF7C5C1C)),
          ),
          child: Row(
            children: [
              const Icon(Icons.wifi_off_rounded,
                  color: Color(0xFFFFC857), size: 20),
              const SizedBox(width: 10),
              Expanded(child: Text(text)),
            ],
          ),
        ),
      ),
    );
  }
}

class MatchSection extends StatelessWidget {
  const MatchSection({
    required this.title,
    required this.emptyText,
    required this.matches,
    required this.connectionState,
    this.priority = false,
    super.key,
  });

  final String title;
  final String emptyText;
  final List<LiveMatch> matches;
  final FeedConnectionState connectionState;
  final bool priority;

  @override
  Widget build(BuildContext context) {
    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 8),
            child: Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
          ),
        ),
        if (matches.isEmpty)
          SliverToBoxAdapter(
            child: EmptyPanel(text: emptyText),
          )
        else
          SliverList.separated(
            itemCount: matches.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final match = matches[index];

              return Padding(
                padding: EdgeInsets.fromLTRB(18, index == 0 ? 0 : 0, 18, 0),
                child: LiveMatchCard(
                  match: match,
                  state: match.viewerState(connectionState),
                  priority: priority,
                ),
              );
            },
          ),
      ],
    );
  }
}

class LiveMatchCard extends StatelessWidget {
  const LiveMatchCard({
    required this.match,
    required this.state,
    this.priority = false,
    super.key,
  });

  final LiveMatch match;
  final ViewerMatchState state;
  final bool priority;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => MatchDetailsScreen(match: match, state: state),
            ),
          );
        },
        child: Ink(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: priority ? const Color(0xFF101C16) : const Color(0xFF101418),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
                color: priority
                    ? const Color(0xFF255F42)
                    : const Color(0xFF20262B)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (match.competitionLogoUrl?.isNotEmpty == true)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: CircleAvatar(
                        radius: 12,
                        backgroundColor: Colors.transparent,
                        backgroundImage:
                            NetworkImage(match.competitionLogoUrl!),
                      ),
                    ),
                  Expanded(
                    child: Text(
                      match.competition,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: const Color(0xFFAAB4AE),
                          fontWeight: FontWeight.w700),
                    ),
                  ),
                  StatusPill(state: state),
                ],
              ),
              const SizedBox(height: 16),
              MatchupPreview(match: match),
              const SizedBox(height: 16),
              Row(
                children: [
                  if (match.sportLogoUrl?.isNotEmpty == true)
                    CircleAvatar(
                      radius: 12,
                      backgroundColor: Colors.transparent,
                      backgroundImage: NetworkImage(match.sportLogoUrl!),
                    ),
                  if (match.sportName?.isNotEmpty == true) ...[
                    if (match.sportLogoUrl?.isNotEmpty == true)
                      const SizedBox(width: 8),
                    Text(
                      match.sportName!,
                      style: const TextStyle(
                          color: Color(0xFFAAB4AE), fontSize: 12),
                    ),
                  ],
                  const Spacer(),
                  Icon(
                    match.hasPlayableStream
                        ? Icons.play_circle_fill_rounded
                        : Icons.error_outline_rounded,
                    color: match.hasPlayableStream
                        ? const Color(0xFF20D37B)
                        : const Color(0xFFFFC857),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  const Icon(Icons.schedule_rounded,
                      size: 16, color: Color(0xFFAAB4AE)),
                  const SizedBox(width: 6),
                  Text(_formatKickoff(match.startsAt),
                      style: const TextStyle(color: Color(0xFFAAB4AE))),
                  const Spacer(),
                  if (match.countryLogoUrl?.isNotEmpty == true)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: CircleAvatar(
                        radius: 10,
                        backgroundColor: Colors.transparent,
                        backgroundImage: NetworkImage(match.countryLogoUrl!),
                      ),
                    ),
                  if (match.countryName?.isNotEmpty == true)
                    Text(
                      match.countryName!,
                      style: const TextStyle(
                          color: Color(0xFFAAB4AE), fontSize: 12),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class TeamLine extends StatelessWidget {
  const TeamLine({required this.name, this.logoUrl, super.key});

  final String name;
  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        CircleAvatar(
          radius: 15,
          backgroundColor: const Color(0xFF1A2228),
          backgroundImage:
              logoUrl?.isNotEmpty == true ? NetworkImage(logoUrl!) : null,
          child: logoUrl?.isNotEmpty != true
              ? Text(name.substring(0, 1),
                  style: const TextStyle(fontWeight: FontWeight.w900))
              : null,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
        ),
      ],
    );
  }
}

class MatchupPreview extends StatelessWidget {
  const MatchupPreview({required this.match, this.large = false, super.key});

  final LiveMatch match;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final logoSize = large ? 58.0 : 46.0;
    final nameStyle = (large
            ? Theme.of(context).textTheme.titleMedium
            : Theme.of(context).textTheme.bodyMedium)
        ?.copyWith(fontWeight: FontWeight.w900);

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: Center(
                child: TeamLogo(
                  name: match.homeTeam,
                  logoUrl: match.homeTeamLogoUrl,
                  size: logoSize,
                ),
              ),
            ),
            Container(
              width: 44,
              alignment: Alignment.center,
              child: const Text(
                'VS',
                style: TextStyle(
                  color: Color(0xFFAAB4AE),
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0,
                ),
              ),
            ),
            Expanded(
              child: Center(
                child: TeamLogo(
                  name: match.awayTeam,
                  logoUrl: match.awayTeamLogoUrl,
                  size: logoSize,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                match.homeTeam,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: nameStyle,
              ),
            ),
            const SizedBox(width: 44),
            Expanded(
              child: Text(
                match.awayTeam,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: nameStyle,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class TeamLogo extends StatelessWidget {
  const TeamLogo({
    required this.name,
    required this.size,
    this.logoUrl,
    super.key,
  });

  final String name;
  final double size;
  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: const Color(0xFF1A2228),
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0xFF2B343B)),
      ),
      child: ClipOval(
        child: logoUrl?.isNotEmpty == true
            ? Image.network(
                logoUrl!,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => TeamLogoFallback(name: name),
              )
            : TeamLogoFallback(name: name),
      ),
    );
  }
}

class TeamLogoFallback extends StatelessWidget {
  const TeamLogoFallback({required this.name, super.key});

  final String name;

  @override
  Widget build(BuildContext context) {
    final initial = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : '?';

    return Center(
      child: Text(
        initial,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class MatchDetailsScreen extends StatelessWidget {
  const MatchDetailsScreen(
      {required this.match, required this.state, super.key});

  final LiveMatch match;
  final ViewerMatchState state;

  @override
  Widget build(BuildContext context) {
    final canWatch = state == ViewerMatchState.live ||
        state == ViewerMatchState.startingSoon;

    return Scaffold(
      appBar: AppBar(title: const Text('Match Details')),
      body: WatermarkedPage(
        logoUrl: match.competitionLogoUrl,
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Row(
                children: [
                  StatusPill(state: state, large: true),
                  const Spacer(),
                  if (match.competitionLogoUrl?.isNotEmpty == true)
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: Colors.transparent,
                      backgroundImage: NetworkImage(match.competitionLogoUrl!),
                    ),
                ],
              ),
              const SizedBox(height: 24),
              MatchupPreview(match: match, large: true),
              const SizedBox(height: 24),
              if (match.sportName?.isNotEmpty == true)
                LogoDetailRow(
                  logoUrl: match.sportLogoUrl,
                  label: 'Sport',
                  value: match.sportName!,
                ),
              if (match.countryName?.isNotEmpty == true)
                LogoDetailRow(
                  logoUrl: match.countryLogoUrl,
                  label: 'Country',
                  value: match.countryName!,
                ),
              LogoDetailRow(
                logoUrl: match.competitionLogoUrl,
                label: 'Competition',
                value: match.competition,
              ),
              DetailRow(
                  icon: Icons.schedule_rounded,
                  label: 'Kickoff',
                  value: _formatKickoff(match.startsAt)),
              DetailRow(
                  icon: Icons.live_tv_rounded,
                  label: 'Stream',
                  value: _streamAvailabilityLabel(match, state)),
              const SizedBox(height: 26),
              FilledButton.icon(
                icon: const Icon(Icons.play_arrow_rounded),
                label: const Text('WATCH LIVE'),
                onPressed: canWatch
                    ? () {
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => PlaybackScreen(match: match),
                          ),
                        );
                      }
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PlaybackScreen extends StatefulWidget {
  const PlaybackScreen({required this.match, super.key});

  final LiveMatch match;

  @override
  State<PlaybackScreen> createState() => _PlaybackScreenState();
}

class _PlaybackScreenState extends State<PlaybackScreen>
    with WidgetsBindingObserver {
  PlaybackState _state = PlaybackState.loading;
  VideoPlayerController? _videoController;
  Future<void>? _initializeVideoPlayerFuture;
  String? _videoError;
  bool _controlsVisible = true;
  Timer? _controlsTimer;
  bool _ownsController = false;
  bool _isFullscreenActive = false;
  PlaybackScaleMode _scaleMode = PlaybackScaleMode.fit;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initializePlayer();
  }

  void _initializePlayer() {
    if (widget.match.playbackUrl.isEmpty) {
      setState(() {
        _state = PlaybackState.failure;
      });
      return;
    }

    _ownsController = true;
    _videoController = VideoPlayerController.networkUrl(
      Uri.parse(widget.match.playbackUrl),
    );

    _state = PlaybackState.connecting;
    _initializeVideoPlayerFuture = _videoController!.initialize().then((_) {
      if (!mounted) return;
      _videoController!
        ..setLooping(true)
        ..play();
      WakelockPlus.enable();
      _scheduleHideControls();
      setState(() => _state = PlaybackState.playing);
    }).catchError((error) {
      if (!mounted) return;
      setState(() {
        _videoError = error.toString();
        _state = PlaybackState.failure;
      });
    });
  }

  void _scheduleHideControls() {
    _controlsTimer?.cancel();
    _controlsTimer = Timer(const Duration(seconds: 5), () {
      if (!mounted) return;
      setState(() => _controlsVisible = false);
    });
  }

  void _showControls() {
    if (!_controlsVisible) {
      setState(() => _controlsVisible = true);
    }
    _scheduleHideControls();
  }

  bool get _isLiveStream => widget.match.hasPlayableStream;

  Widget _buildLiveBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFFF5D5D).withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
        border:
            Border.all(color: const Color(0xFFFF5D5D).withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              color: Color(0xFFFF5D5D),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            _isLiveStream ? 'LIVE' : 'STREAM',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPortraitSeekBar() {
    if (_videoController == null) {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF101418).withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFF20262B)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              height: 3,
              decoration: BoxDecoration(
                color: const Color(0xFF6B6B6B),
                borderRadius: BorderRadius.circular(999),
              ),
              alignment: Alignment.centerRight,
              child: Container(
                width: 11,
                height: 11,
                decoration: const BoxDecoration(
                  color: Colors.red,
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          const Text(
            'LIVE',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w900,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }

  void _togglePlayPause() {
    if (_videoController == null || !_videoController!.value.isInitialized) {
      return;
    }

    if (_videoController!.value.isPlaying) {
      _videoController!.pause();
      setState(() => _state = PlaybackState.buffering);
    } else {
      _videoController!.play();
      setState(() => _state = PlaybackState.playing);
    }
    _scheduleHideControls();
  }

  Future<void> _enterFullscreen() async {
    if (_videoController == null || !_videoController!.value.isInitialized) {
      return;
    }

    setState(() => _isFullscreenActive = true);
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _scheduleHideControls();
  }

  Future<void> _exitFullscreen() async {
    setState(() => _isFullscreenActive = false);
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    _scheduleHideControls();
  }

  Widget _buildVideoSurface() {
    if (_videoController == null || !_videoController!.value.isInitialized) {
      return const SizedBox.shrink();
    }

    final aspectRatio = _videoController!.value.aspectRatio;

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = constraints.maxWidth;
        final maxHeight = constraints.maxHeight;
        var width = maxWidth;
        var height = width / aspectRatio;
        var scale = 1.0;

        if (height > maxHeight) {
          height = maxHeight;
          width = height * aspectRatio;
        }

        if (_isFullscreenActive && _scaleMode != PlaybackScaleMode.fit) {
          final coverWidth = maxWidth;
          final coverHeight = coverWidth / aspectRatio;
          final needsHeightCover = coverHeight < maxHeight;
          height = needsHeightCover ? maxHeight : coverHeight;
          width = needsHeightCover ? height * aspectRatio : coverWidth;
          scale = _scaleMode == PlaybackScaleMode.zoom ? 1.16 : 1.0;
        }

        return Center(
          child: ClipRect(
            child: Transform.scale(
              scale: scale,
              child: SizedBox(
                width: width,
                height: height,
                child: VideoPlayer(_videoController!),
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controlsTimer?.cancel();
    if (_isFullscreenActive) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    }
    if (_ownsController) {
      _videoController?.dispose();
      WakelockPlus.disable();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_videoController == null) {
      return;
    }

    if (state == AppLifecycleState.resumed &&
        _videoController!.value.isInitialized &&
        _state == PlaybackState.playing) {
      _videoController!.play();
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget content;

    if (_state == PlaybackState.failure || widget.match.playbackUrl.isEmpty) {
      content = const PlaybackPanel(state: PlaybackState.failure);
    } else {
      content = FutureBuilder<void>(
        future: _initializeVideoPlayerFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const PlaybackPanel(state: PlaybackState.connecting);
          }

          if (snapshot.hasError ||
              _videoController == null ||
              !_videoController!.value.isInitialized) {
            return const PlaybackPanel(state: PlaybackState.failure);
          }

          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _showControls,
            child: SizedBox.expand(
              child: Stack(
                children: [
                  Container(color: Colors.black),
                  _buildVideoSurface(),
                  if (_controlsVisible)
                    Positioned.fill(
                      child: Container(color: Colors.black26),
                    ),
                  if (_controlsVisible && !_isFullscreenActive)
                    Positioned(
                      top: 18,
                      left: 18,
                      right: 18,
                      child: Row(
                        children: [
                          _buildLiveBadge(),
                          const Spacer(),
                          IconButton(
                            icon: const Icon(Icons.fullscreen_rounded),
                            color: Colors.white,
                            onPressed: widget.match.playbackUrl.isNotEmpty &&
                                    _videoController != null
                                ? _enterFullscreen
                                : null,
                          ),
                        ],
                      ),
                    ),
                  if (_controlsVisible)
                    Center(
                      child: IconButton(
                        iconSize: 82,
                        color: Colors.white,
                        icon: Icon(_videoController!.value.isPlaying
                            ? Icons.pause_rounded
                            : Icons.play_arrow_rounded),
                        onPressed: _togglePlayPause,
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      );
    }

    if (_isFullscreenActive) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            Center(child: content),
            if (_controlsVisible)
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.fullscreen_exit,
                            color: Colors.white),
                        onPressed: _exitFullscreen,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          '${widget.match.homeTeam} vs ${widget.match.awayTeam}',
                          style: const TextStyle(
                              color: Colors.white, fontSize: 16),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      PopupMenuButton<PlaybackScaleMode>(
                        icon:
                            const Icon(Icons.aspect_ratio, color: Colors.white),
                        color: const Color(0xFF101418),
                        itemBuilder: (context) => PlaybackScaleMode.values
                            .map(
                              (mode) => PopupMenuItem<PlaybackScaleMode>(
                                value: mode,
                                child: Text(mode.name.toUpperCase()),
                              ),
                            )
                            .toList(),
                        onSelected: (mode) {
                          setState(() => _scaleMode = mode);
                        },
                      ),
                    ],
                  ),
                ),
              ),
            if (_controlsVisible)
              Positioned(
                left: 0,
                right: 0,
                bottom: 18,
                child: _buildPortraitSeekBar(),
              ),
            if (_videoError != null || _state != PlaybackState.playing)
              Positioned(
                left: 0,
                right: 0,
                bottom: 18,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      _videoError != null
                          ? 'Playback failed: $_videoError'
                          : _playbackMessage(_state),
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: Row(
          children: [
            if (widget.match.competitionLogoUrl?.isNotEmpty == true) ...[
              CircleAvatar(
                radius: 16,
                backgroundColor: Colors.transparent,
                backgroundImage: NetworkImage(widget.match.competitionLogoUrl!),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                '${widget.match.homeTeam} vs ${widget.match.awayTeam}',
                style: const TextStyle(fontSize: 16),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: content,
            ),
          ),
          if (_controlsVisible) ...[
            _buildPortraitSeekBar(),
            const SizedBox(height: 12),
          ],
          if (_videoError != null || _state != PlaybackState.playing)
            Padding(
              padding: const EdgeInsets.all(18),
              child: Text(
                _videoError != null
                    ? 'Playback failed: $_videoError'
                    : _state == PlaybackState.connecting
                        ? _playbackMessage(_state)
                        : '',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFFAAB4AE)),
              ),
            ),
        ],
      ),
    );
  }
}

class PlaybackPanel extends StatelessWidget {
  const PlaybackPanel({required this.state, super.key});

  final PlaybackState state;

  @override
  Widget build(BuildContext context) {
    final isFailure = state == PlaybackState.failure;

    return AspectRatio(
      aspectRatio: 16 / 9,
      child: Container(
        margin: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFF080B0E),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFF20262B)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isFailure
                  ? Icons.signal_wifi_bad_rounded
                  : Icons.play_circle_fill_rounded,
              color:
                  isFailure ? const Color(0xFFFFC857) : const Color(0xFF20D37B),
              size: 58,
            ),
            const SizedBox(height: 18),
            Text(
              _playbackTitle(state),
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            if (state == PlaybackState.loading ||
                state == PlaybackState.connecting) ...[
              const SizedBox(height: 18),
              const SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(strokeWidth: 3)),
            ],
          ],
        ),
      ),
    );
  }
}

class CompetitionBrowser extends StatelessWidget {
  const CompetitionBrowser({required this.matches, super.key});

  final List<LiveMatch> matches;

  @override
  Widget build(BuildContext context) {
    final sports = <String, Map<String, Map<String, List<LiveMatch>>>>{};
    final sportLogos = <String, String?>{};
    final countryLogos = <String, String?>{};

    for (final match in matches) {
      final sportName =
          match.sportName?.isNotEmpty == true ? match.sportName! : 'All Sports';
      final countryName =
          match.countryName?.isNotEmpty == true ? match.countryName! : 'Global';
      final competitionName = match.competition;

      sportLogos[sportName] = sportLogos[sportName] ?? match.sportLogoUrl;
      countryLogos[countryName] =
          countryLogos[countryName] ?? match.countryLogoUrl;

      final countries = sports.putIfAbsent(sportName, () => {});
      final competitions = countries.putIfAbsent(countryName, () => {});
      competitions.putIfAbsent(competitionName, () => []).add(match);
    }

    return SafeArea(
      child: ListView(
        key: const PageStorageKey('competition-browser'),
        padding: const EdgeInsets.all(18),
        children: [
          Text('Live sports catalogue',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          const Text('Sport → Country → Competition → Matches',
              style: TextStyle(color: Color(0xFFAAB4AE))),
          const SizedBox(height: 18),
          if (sports.isEmpty)
            const EmptyPanel(
              text: 'Live competitions appear here when streams are available.',
            )
          else
            ...sports.entries.map(
              (sportEntry) => SportTile(
                sportName: sportEntry.key,
                sportLogoUrl: sportLogos[sportEntry.key],
                countries: sportEntry.value,
                countryLogos: countryLogos,
              ),
            ),
        ],
      ),
    );
  }
}

class SportTile extends StatelessWidget {
  const SportTile({
    required this.sportName,
    required this.sportLogoUrl,
    required this.countries,
    required this.countryLogos,
    super.key,
  });

  final String sportName;
  final String? sportLogoUrl;
  final Map<String, Map<String, List<LiveMatch>>> countries;
  final Map<String, String?> countryLogos;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF101418),
      child: ExpansionTile(
        leading: CircleAvatar(
          backgroundColor: const Color(0xFF0F1612),
          backgroundImage: sportLogoUrl?.isNotEmpty == true
              ? NetworkImage(sportLogoUrl!)
              : null,
          child: sportLogoUrl?.isNotEmpty != true
              ? Text(sportName.substring(0, 1).toUpperCase())
              : null,
        ),
        title: Text(sportName, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('${countries.length} countries'),
        children: countries.entries
            .map((countryEntry) => CountryTile(
                  countryName: countryEntry.key,
                  countryLogoUrl: countryLogos[countryEntry.key],
                  competitions: countryEntry.value,
                ))
            .toList(growable: false),
      ),
    );
  }
}

class CountryTile extends StatelessWidget {
  const CountryTile({
    required this.countryName,
    required this.countryLogoUrl,
    required this.competitions,
    super.key,
  });

  final String countryName;
  final String? countryLogoUrl;
  final Map<String, List<LiveMatch>> competitions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: Card(
        color: const Color(0xFF0D1411),
        child: ExpansionTile(
          leading: CircleAvatar(
            radius: 16,
            backgroundColor: const Color(0xFF0F1612),
            backgroundImage: countryLogoUrl?.isNotEmpty == true
                ? NetworkImage(countryLogoUrl!)
                : null,
            child: countryLogoUrl?.isNotEmpty != true
                ? Text(countryName.substring(0, 1).toUpperCase())
                : null,
          ),
          title:
              Text(countryName, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text('${competitions.length} competitions'),
          children: competitions.entries
              .map((competitionEntry) => CompetitionTile(
                    competition: competitionEntry.key,
                    matches: competitionEntry.value,
                  ))
              .toList(growable: false),
        ),
      ),
    );
  }
}

class CompetitionTile extends StatelessWidget {
  const CompetitionTile({
    required this.competition,
    required this.matches,
    super.key,
  });

  final String competition;
  final List<LiveMatch> matches;

  @override
  Widget build(BuildContext context) {
    final logoUrl = matches.first.competitionLogoUrl;
    return Padding(
      padding: const EdgeInsets.only(left: 16),
      child: Card(
        color: const Color(0xFF0C1210),
        child: ExpansionTile(
          leading: CircleAvatar(
            radius: 16,
            backgroundColor: const Color(0xFF0F1612),
            backgroundImage:
                logoUrl?.isNotEmpty == true ? NetworkImage(logoUrl!) : null,
            child: logoUrl?.isNotEmpty != true
                ? Text(competition.substring(0, 1).toUpperCase())
                : null,
          ),
          title:
              Text(competition, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text(
              '${matches.length} live match${matches.length == 1 ? '' : 'es'}'),
          children: matches
              .map((match) => ListTile(
                    title: Text('${match.homeTeam} vs ${match.awayTeam}'),
                    subtitle: Text(_formatKickoff(match.startsAt)),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => MatchDetailsScreen(
                              match: match,
                              state: match
                                  .viewerState(FeedConnectionState.online)),
                        ),
                      );
                    },
                  ))
              .toList(growable: false),
        ),
      ),
    );
  }
}

class CompetitionStrip extends StatelessWidget {
  const CompetitionStrip({required this.competitions, super.key});

  final List<String> competitions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Competitions',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900)),
          const SizedBox(height: 10),
          if (competitions.isEmpty)
            const EmptyPanel(text: 'Live competitions will appear here.')
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: competitions
                  .map(
                    (competition) => Chip(
                      label: Text(competition),
                      backgroundColor: const Color(0xFF101418),
                      side: const BorderSide(color: Color(0xFF20262B)),
                    ),
                  )
                  .toList(growable: false),
            ),
        ],
      ),
    );
  }
}

class LogoDetailRow extends StatelessWidget {
  const LogoDetailRow({
    required this.label,
    required this.value,
    this.logoUrl,
    super.key,
  });

  final String label;
  final String value;
  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    final initial =
        value.isNotEmpty ? value.substring(0, 1).toUpperCase() : '?';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: const Color(0xFF1A2228),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFF2B343B)),
            ),
            child: ClipOval(
              child: logoUrl?.isNotEmpty == true
                  ? Image.network(
                      logoUrl!,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) =>
                          Center(child: Text(initial)),
                    )
                  : Center(child: Text(initial)),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        color: Color(0xFFAAB4AE), fontSize: 12)),
                Text(value, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class DetailRow extends StatelessWidget {
  const DetailRow(
      {required this.icon,
      required this.label,
      required this.value,
      super.key});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF20D37B)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        color: Color(0xFFAAB4AE), fontSize: 12)),
                Text(value, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({required this.state, this.large = false, super.key});

  final ViewerMatchState state;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final style = _statusStyle(state);

    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: large ? 14 : 10, vertical: large ? 8 : 6),
      decoration: BoxDecoration(
        color: style.color.withAlpha(41),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: style.color.withAlpha(163)),
      ),
      child: Text(
        style.label,
        style: TextStyle(
          color: style.color,
          fontSize: large ? 14 : 11,
          fontWeight: FontWeight.w900,
          letterSpacing: 0,
        ),
      ),
    );
  }
}

class ConnectionDot extends StatelessWidget {
  const ConnectionDot({required this.state, super.key});

  final FeedConnectionState state;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      FeedConnectionState.online => const Color(0xFF20D37B),
      FeedConnectionState.reconnecting => const Color(0xFFFFC857),
      FeedConnectionState.offline => const Color(0xFFFF5D5D),
    };

    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class EmptyPanel extends StatelessWidget {
  const EmptyPanel({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF101418),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFF20262B)),
        ),
        child: Text(text, style: const TextStyle(color: Color(0xFFAAB4AE))),
      ),
    );
  }
}

({Color color, String label}) _statusStyle(ViewerMatchState state) {
  return switch (state) {
    ViewerMatchState.live => (color: const Color(0xFF20D37B), label: 'LIVE'),
    ViewerMatchState.startingSoon => (
        color: const Color(0xFF4DA3FF),
        label: 'STARTING SOON'
      ),
    ViewerMatchState.ended => (color: const Color(0xFFAAB4AE), label: 'ENDED'),
    ViewerMatchState.streamIssue => (
        color: const Color(0xFFFFC857),
        label: 'STREAM ISSUE'
      ),
    ViewerMatchState.offline => (
        color: const Color(0xFFFF5D5D),
        label: 'OFFLINE'
      ),
  };
}

String _formatKickoff(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');

  return '${local.month}/${local.day} $hour:$minute';
}

String _streamAvailabilityLabel(LiveMatch match, ViewerMatchState state) {
  if (state == ViewerMatchState.offline) {
    return 'Feed offline';
  }

  if (match.hasPlayableStream) {
    return 'Available';
  }

  return 'Temporarily unavailable';
}

String _scoreStatusLabel(String status) {
  return switch (status) {
    'IN_PLAY' => 'LIVE',
    'PAUSED' => 'HALFTIME',
    'FINISHED' => 'FULLTIME',
    'TIMED' || 'SCHEDULED' => 'SCHEDULED',
    'POSTPONED' => 'POSTPONED',
    'CANCELLED' => 'CANCELLED',
    _ => status.replaceAll('_', ' '),
  };
}

String _playbackTitle(PlaybackState state) {
  return switch (state) {
    PlaybackState.loading => 'Loading stream',
    PlaybackState.connecting => 'Connecting',
    PlaybackState.playing => 'Playing live',
    PlaybackState.buffering => 'Buffering',
    PlaybackState.failure => 'Stream unavailable',
  };
}

String _playbackMessage(PlaybackState state) {
  return switch (state) {
    PlaybackState.loading => 'Preparing the live stream.',
    PlaybackState.connecting => 'Opening the best available connection.',
    PlaybackState.playing => 'You are watching the live feed.',
    PlaybackState.buffering =>
      'Connection is unstable. Playback will resume automatically.',
    PlaybackState.failure =>
      'The stream is not available right now. Go back and try again shortly.',
  };
}
