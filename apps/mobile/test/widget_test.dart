import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:gito_live_sports_mobile/main.dart';
import 'package:gito_live_sports_mobile/models/mobile_models.dart';
import 'package:gito_live_sports_mobile/services/mobile_api_service.dart';

void main() {
  testWidgets('App starts and shows app title', (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.text('GiTO Live Sports'), findsOneWidget);
    expect(find.byIcon(Icons.live_tv_rounded), findsOneWidget);
  });

  testWidgets('Personalize flow is reachable and shows sports selection', (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.byTooltip('Personalize GiTO'), findsOneWidget);
    await tester.pumpWidget(
      MaterialApp(
        home: const GitoPersonalizeScreen(api: _CatalogApi()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Personalize GiTO'), findsOneWidget);
    expect(find.text('What sports do you follow?'), findsOneWidget);
    expect(find.text('Soccer'), findsOneWidget);
  });

  testWidgets('Following screen surfaces selected sports and teams', (WidgetTester tester) async {
    final pref = await TestSharedPreferences.setUp();
    await pref.setStringList('gito_followed_sports', ['football', 'basketball']);
    await pref.setStringList('gito_followed_teams', ['barcelona', 'man-city']);

    await tester.pumpWidget(const GitoLiveSportsApp());
    await tester.tap(find.byTooltip('Following'));
    await tester.pumpAndSettle();

    expect(find.text('Following'), findsOneWidget);
    expect(find.text('Football'), findsOneWidget);
    expect(find.text('Barcelona'), findsOneWidget);
  });

  testWidgets('Sports screen shows sport host navigation instead of a direct fixture list', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(home: SportsScreen(api: _CatalogApi())));
    await tester.pumpAndSettle();

    expect(find.text('Soccer'), findsOneWidget);
    await tester.tap(find.text('Soccer'));
    await tester.pumpAndSettle();

    expect(find.text('Spain'), findsOneWidget);
    await tester.tap(find.text('Spain'));
    await tester.pumpAndSettle();

    expect(find.text('League One'), findsOneWidget);
  });
}

class _CatalogApi extends MobileApiService {
  const _CatalogApi();

  @override
  Future<List<MobileSport>> getSports() async => const [
        MobileSport(id: 'sport-1', name: 'Soccer', slug: 'soccer'),
      ];

  @override
  Future<List<MobileHost>> getHosts({required String sportId}) async => const [
        MobileHost(id: 'host-1', sportId: 'sport-1', name: 'Spain'),
      ];

  @override
  Future<List<MobileCompetition>> getCompetitions({String? sportId, String? hostId}) async => const [
        MobileCompetition(id: 'competition-1', name: 'League One', sportId: 'sport-1'),
      ];

  @override
  Future<List<MobileClub>> getClubs({List<String> teamIds = const <String>[]}) async => const [
        MobileClub(id: 'team-1', name: 'Example FC', sportId: 'sport-1', status: 'active'),
      ];
}

class TestSharedPreferences {
  static Future<SharedPreferences> setUp() async {
    SharedPreferences.setMockInitialValues({});
    return SharedPreferences.getInstance();
  }
}
