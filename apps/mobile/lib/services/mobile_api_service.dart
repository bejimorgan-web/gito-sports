import 'dart:convert';
import 'dart:io';

import 'package:shared_preferences/shared_preferences.dart';

import '../app_config.dart';
import '../models/mobile_models.dart';

class MobileApiException implements Exception {
  const MobileApiException(this.message, this.statusCode);
  final String message;
  final int statusCode;
  @override
  String toString() => message;
}

class MobileApiService {
  const MobileApiService({this.baseUrl = apiBaseUrl});
  final String baseUrl;

  Future<dynamic> _get(String path) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 6);
    try {
      final request = await client.getUrl(Uri.parse('$baseUrl$path'));
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      final response =
          await request.close().timeout(const Duration(seconds: 10));
      final body = await response.transform(utf8.decoder).join();
      dynamic decoded;
      try {
        decoded = jsonDecode(body);
      } catch (_) {
        decoded = null;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw MobileApiException(
            decoded is Map
                ? '${decoded['error'] ?? 'Request failed'}'
                : 'Request failed',
            response.statusCode);
      }
      return decoded is Map && decoded.containsKey('data')
          ? decoded['data']
          : decoded;
    } finally {
      client.close(force: true);
    }
  }

  Future<List<MobileSport>> getSports() async =>
      ((await _get('/mobile/sports')) as List)
          .whereType<Map>()
          .map((item) => MobileSport.fromJson(Map<String, dynamic>.from(item)))
          .toList();
  Future<List<MobileHost>> getHosts({required String sportId}) async =>
      ((await _get('/hosts?sportId=${Uri.encodeQueryComponent(sportId)}')) as List)
          .whereType<Map>()
          .map((item) => MobileHost.fromJson(Map<String, dynamic>.from(item)))
          .toList();

  Future<List<MobileCompetition>> getCompetitions({String? sportId, String? hostId}) async {
    final query = <String, String>{
      if (sportId != null) 'sportId': sportId,
      if (hostId != null) 'hostId': hostId,
    };
    final path = '/mobile/competitions${query.isEmpty ? '' : '?${Uri(queryParameters: query).query}'}';
    return ((await _get(path)) as List)
        .whereType<Map>()
        .map((item) => MobileCompetition.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }


  Future<List<MobileCompetition>> getCompetitionsForHost(String sportId, String hostId) async =>
      getCompetitions(sportId: sportId, hostId: hostId);

  Future<List<MobileClub>> getClubs(
      {List<String> teamIds = const <String>[]}) async {
    final query = teamIds.isEmpty
        ? ''
        : '?teamIds=${Uri.encodeQueryComponent(teamIds.join(','))}';
    return ((await _get('/mobile/clubs$query')) as List)
        .whereType<Map>()
        .map((item) => MobileClub.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  Future<MobileClubDetail> getClub(String clubId) async =>
      MobileClubDetail.fromJson(
          Map<String, dynamic>.from(await _get('/mobile/clubs/$clubId')));
  Future<List<MobileNewsArticle>> getClubNews(String clubId) async =>
      _news('/mobile/clubs/$clubId/news');
  Future<List<MobileFixture>> getClubFixtures(String clubId) async =>
      _fixtures('/mobile/clubs/$clubId/fixtures');
  Future<List<MobileFixture>> getClubResults(String clubId) async =>
      _fixtures('/mobile/clubs/$clubId/results');
  Future<List<MobileFixture>> getClubLive(String clubId) async =>
      _fixtures('/mobile/clubs/$clubId/live');
  Future<List<MobileNewsArticle>> getNews(
      {String? teamId,
      String? competitionId,
      String? sportId,
      String? countryId,
      String? matchId,
      String? mode,
      List<String> teamIds = const <String>[],
      List<String> competitionIds = const <String>[],
      List<String> sportIds = const <String>[]}) async {
    final query = <String, String>{
      if (teamId != null) 'teamId': teamId,
      if (competitionId != null) 'competitionId': competitionId,
      if (sportId != null) 'sportId': sportId,
      if (countryId != null) 'countryId': countryId,
      if (matchId != null) 'matchId': matchId,
      if (mode != null) 'mode': mode,
      if (teamIds.isNotEmpty) 'teamIds': teamIds.join(','),
      if (competitionIds.isNotEmpty) 'competitionIds': competitionIds.join(','),
      if (sportIds.isNotEmpty) 'sportIds': sportIds.join(',')
    };
    return _news(
        '/mobile/news${query.isEmpty ? '' : '?${Uri(queryParameters: query).query}'}');
  }

  Future<List<MobileFixture>> getFixtures({
    String? mode,
    String? sportId,
    List<String> teamIds = const <String>[],
    List<String> competitionIds = const <String>[],
    List<String> sportIds = const <String>[],
    String? from,
    String? to,
    String? status,
  }) async {
    final query = <String, String>{
      if (mode != null) 'mode': mode,
      if (sportId != null) 'sportId': sportId,
      if (teamIds.isNotEmpty) 'teamIds': teamIds.join(','),
      if (competitionIds.isNotEmpty) 'competitionIds': competitionIds.join(','),
      if (sportIds.isNotEmpty) 'sportIds': sportIds.join(','),
      if (from != null) 'from': from,
      if (to != null) 'to': to,
      if (status != null) 'status': status,
    };
    return _fixtures(
        '/mobile/fixtures${query.isEmpty ? '' : '?${Uri(queryParameters: query).query}'}');
  }

  Future<MobileNewsArticle> getNewsArticle(String articleId) async =>
      MobileNewsArticle.fromJson(
          Map<String, dynamic>.from(await _get('/mobile/news/$articleId')));

  Future<MobileFixture> getFixture(String fixtureId, {String? clubId}) async =>
      MobileFixture.fromJson(
          Map<String, dynamic>.from(await _get('/mobile/fixtures/$fixtureId${clubId == null ? '' : '?clubId=${Uri.encodeQueryComponent(clubId)}'}')));

  Future<List<MobileNewsArticle>> getCompetitionNews(
          String competitionId) async =>
      _news('/mobile/competitions/$competitionId/news');
  Future<List<MobileFixture>> getCompetitionFixtures(
          String competitionId) async =>
      _fixtures('/mobile/competitions/$competitionId/fixtures');
  Future<List<MobileSeason>> getCompetitionSeasons(
          String competitionId) async =>
      ((await _get('/mobile/competitions/$competitionId/seasons')) as List)
          .whereType<Map>()
          .map((item) => MobileSeason.fromJson(Map<String, dynamic>.from(item)))
          .toList();
  Future<MobileSeason> getSeason(String seasonId) async =>
      MobileSeason.fromJson(
          Map<String, dynamic>.from(await _get('/mobile/seasons/$seasonId')));
  Future<List<MobileFixture>> getSeasonFixtures(String seasonId) async =>
      _fixtures('/mobile/seasons/$seasonId/fixtures');
  Future<List<MobileClub>> getSeasonTeams(String seasonId) async =>
      ((await _get('/mobile/seasons/$seasonId/teams')) as List)
          .whereType<Map>()
          .map((item) => MobileClub.fromJson(Map<String, dynamic>.from(item)))
          .toList();

  Future<List<MobileNewsArticle>> _news(String path) async =>
      ((await _get(path)) as List)
          .whereType<Map>()
          .map((item) =>
              MobileNewsArticle.fromJson(Map<String, dynamic>.from(item)))
          .toList();
  Future<List<MobileFixture>> _fixtures(String path) async =>
      ((await _get(path)) as List)
          .whereType<Map>()
          .map(
              (item) => MobileFixture.fromJson(Map<String, dynamic>.from(item)))
          .toList();
}

class MobileFollowingIds {
  const MobileFollowingIds(
      {required this.sports, required this.competitions, required this.teams});
  final List<String> sports;
  final List<String> competitions;
  final List<String> teams;
}

String _normalizeFollowingValue(String? value) => (value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
    .trim()
    .replaceAll(RegExp(r'\s+'), ' ');

Future<MobileFollowingIds> resolveMobileFollowingIds(
    MobileApiService api) async {
  final prefs = await SharedPreferences.getInstance();
  final followedSports =
      (prefs.getStringList('gito_followed_sports') ?? const <String>[])
          .map(_normalizeFollowingValue)
          .toSet();
  final followedCompetitions =
      (prefs.getStringList('gito_followed_competitions') ?? const <String>[])
          .map(_normalizeFollowingValue)
          .toSet();
  final followedTeams =
      (prefs.getStringList('gito_followed_teams') ?? const <String>[])
          .map(_normalizeFollowingValue)
          .toSet();
  final catalogs = await Future.wait<dynamic>(
      [api.getSports(), api.getCompetitions(), api.getClubs()]);
  final sports = (catalogs[0] as List<MobileSport>)
      .where((item) =>
          followedSports.contains(_normalizeFollowingValue(item.name)) ||
          followedSports.contains(_normalizeFollowingValue(item.slug)))
      .map((item) => item.id)
      .toList();
  final competitions = (catalogs[1] as List<MobileCompetition>)
      .where((item) =>
          followedCompetitions.contains(_normalizeFollowingValue(item.name)) ||
          followedCompetitions.contains(_normalizeFollowingValue(item.slug)))
      .map((item) => item.id)
      .toList();
  final teams = (catalogs[2] as List<MobileClub>)
      .where((item) =>
          followedTeams.contains(_normalizeFollowingValue(item.name)) ||
          followedTeams.contains(_normalizeFollowingValue(item.shortName)) ||
          followedTeams.contains(_normalizeFollowingValue(item.slug)))
      .map((item) => item.id)
      .toList();
  return MobileFollowingIds(
      sports: sports, competitions: competitions, teams: teams);
}
