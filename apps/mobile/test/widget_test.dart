import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:gito_live_sports_mobile/main.dart';

void main() {
  testWidgets('App starts and shows app title', (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.text('GiTO Live Sports'), findsOneWidget);
    expect(find.byIcon(Icons.live_tv_rounded), findsOneWidget);
  });

  testWidgets('Personalize flow is reachable and shows sports selection', (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.byTooltip('Personalize GiTO'), findsOneWidget);
    await tester.tap(find.byTooltip('Personalize GiTO'));
    await tester.pumpAndSettle();

    expect(find.text('Personalize GiTO'), findsOneWidget);
    expect(find.text('What sports do you follow?'), findsOneWidget);
    expect(find.text('Football'), findsOneWidget);
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
}

class TestSharedPreferences {
  static Future<SharedPreferences> setUp() async {
    SharedPreferences.setMockInitialValues({});
    return SharedPreferences.getInstance();
  }
}
