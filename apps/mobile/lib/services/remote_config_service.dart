import 'dart:convert';
import 'dart:io';
import 'package:shared_preferences/shared_preferences.dart';

/// Remote configuration for mobile navigation features.
class MobileNavigationConfig {
  final bool liveScores;
  final bool sports;
  final bool live;

  MobileNavigationConfig({
    required this.liveScores,
    required this.sports,
    required this.live,
  });

  factory MobileNavigationConfig.fromJson(Map<String, dynamic> json) {
    return MobileNavigationConfig(
      liveScores: json['liveScores'] as bool? ?? true,
      sports: json['sports'] as bool? ?? true,
      live: json['live'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'liveScores': liveScores,
    'sports': sports,
    'live': live,
  };

  /// Returns a copy with selected fields replaced.
  MobileNavigationConfig copyWith({
    bool? liveScores,
    bool? sports,
    bool? live,
  }) {
    return MobileNavigationConfig(
      liveScores: liveScores ?? this.liveScores,
      sports: sports ?? this.sports,
      live: live ?? this.live,
    );
  }
}

/// Service for fetching and caching remote mobile configuration.
class RemoteConfigService {
  static const String _cacheKeyNavigation = 'gito_nav_config';
  static const Duration _cacheTtl = Duration(hours: 24);

  final String apiBaseUrl;
  final SharedPreferences prefs;

  MobileNavigationConfig? _cachedConfig;
  DateTime? _cachedAt;

  RemoteConfigService({
    required this.apiBaseUrl,
    required this.prefs,
  });

  /// Get the current navigation configuration.
  /// Returns cached data if available, otherwise fetches fresh.
  Future<MobileNavigationConfig> getNavigationConfig() async {
    // Check in-memory cache first
    if (_cachedConfig != null && _isCacheValid()) {
      print('[RemoteConfig] Using in-memory cached navigation config');
      return _cachedConfig!;
    }

    // Check local storage cache
    final cached = _loadCachedConfig();
    if (cached != null && _isCacheValid()) {
      print('[RemoteConfig] Using persisted cached navigation config');
      _cachedConfig = cached;
      return cached;
    }

    // Fetch fresh from backend
    try {
      print('[RemoteConfig] Fetching fresh navigation config from API');
      final config = await _fetchFromBackend();
      
      // Cache in-memory and storage
      _cachedConfig = config;
      _cachedAt = DateTime.now();
      await _saveCachedConfig(config);
      
      print('[RemoteConfig] Successfully fetched and cached navigation config');
      return config;
    } catch (e) {
      print('[RemoteConfig] Failed to fetch config: $e');
      
      // Fall back to cached data even if expired
      if (cached != null) {
        print('[RemoteConfig] Falling back to stale cached config');
        return cached;
      }
      
      // Fall back to all enabled if no cache available
      print('[RemoteConfig] No cache available, returning defaults (all enabled)');
      return MobileNavigationConfig(
        liveScores: true,
        sports: true,
        live: true,
      );
    }
  }

  /// Fetch navigation config from the backend API.
  Future<MobileNavigationConfig> _fetchFromBackend() async {
    final url = '$apiBaseUrl/mobile/features';
    print('[RemoteConfig] GET $url');

    final response = await _makeHttpRequest(url);
    if (response == null) {
      throw Exception('Network request failed');
    }

    try {
      final json = jsonDecode(response) as Map<String, dynamic>;
      final data = json['data'] as Map<String, dynamic>?;
      if (data == null) {
        throw Exception('Response missing data field');
      }
      final navigationJson = data['navigation'] as Map<String, dynamic>? ?? {};
      return MobileNavigationConfig.fromJson(navigationJson);
    } catch (e) {
      throw Exception('Failed to parse config response: $e');
    }
  }

  /// Make HTTP GET request using dart:io HttpClient.
  Future<String?> _makeHttpRequest(String url) async {
    final uri = Uri.parse(url);
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 6);
    try {
      final request = await client.getUrl(uri);
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      final response = await request.close().timeout(const Duration(seconds: 10));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException('HTTP ${response.statusCode}');
      }

      return await response.transform(utf8.decoder).join();
    } catch (e) {
      print('[RemoteConfig] HTTP request failed: $e');
      return null;
    } finally {
      client.close(force: true);
    }
  }

  /// Load configuration from local storage cache.
  MobileNavigationConfig? _loadCachedConfig() {
    try {
      final json = prefs.getString(_cacheKeyNavigation);
      if (json == null) return null;

      final decoded = jsonDecode(json) as Map<String, dynamic>;
      final cachedConfig = decoded['config'] as Map<String, dynamic>?;
      final cachedAtString = decoded['cachedAt'] as String?;
      if (cachedConfig == null || cachedAtString == null) {
        return null;
      }

      _cachedAt = DateTime.tryParse(cachedAtString);
      return MobileNavigationConfig.fromJson(cachedConfig);
    } catch (e) {
      print('[RemoteConfig] Failed to load cached config: $e');
      return null;
    }
  }

  /// Save configuration to local storage cache.
  Future<void> _saveCachedConfig(MobileNavigationConfig config) async {
    try {
      final json = jsonEncode({
        'config': config.toJson(),
        'cachedAt': _cachedAt?.toIso8601String(),
      });
      await prefs.setString(_cacheKeyNavigation, json);
      print('[RemoteConfig] Cached navigation config to storage');
    } catch (e) {
      print('[RemoteConfig] Failed to save cache: $e');
    }
  }

  /// Check if in-memory cache is still valid.
  bool _isCacheValid() {
    if (_cachedAt == null) return false;
    return DateTime.now().difference(_cachedAt!).inSeconds < _cacheTtl.inSeconds;
  }

  /// Clear all caches (for testing/logout).
  Future<void> clearCache() async {
    _cachedConfig = null;
    _cachedAt = null;
    await prefs.remove(_cacheKeyNavigation);
    print('[RemoteConfig] Cleared all caches');
  }
}
