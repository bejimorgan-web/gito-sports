import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../lib/services/remote_config_service.dart';

void main() {
  test('stale cached Live ON cannot authorize playback', () async {
    SharedPreferences.setMockInitialValues({
      'gito_nav_config': jsonEncode({
        'config': {'liveScores': true, 'sports': true, 'live': true},
        'cachedAt': DateTime.now().toIso8601String(),
      }),
    });

    final prefs = await SharedPreferences.getInstance();
    final config = await RemoteConfigService(
      apiBaseUrl: 'http://127.0.0.1:1',
      prefs: prefs,
    ).getNavigationConfig();

    expect(config.live, isFalse);
    expect(config.sports, isTrue);
  });

  test('missing Live configuration fails closed while preserving Sports', () async {
    SharedPreferences.setMockInitialValues({});

    final prefs = await SharedPreferences.getInstance();
    final config = await RemoteConfigService(
      apiBaseUrl: 'http://127.0.0.1:1',
      prefs: prefs,
    ).getNavigationConfig();

    expect(config.live, isFalse);
    expect(config.sports, isTrue);
  });
}