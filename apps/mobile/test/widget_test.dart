import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gito_live_sports_mobile/main.dart';

void main() {
  testWidgets('App starts and shows app title', (WidgetTester tester) async {
    await tester.pumpWidget(const GitoLiveSportsApp());

    expect(find.text('GiTO Live Sports'), findsOneWidget);
    expect(find.byIcon(Icons.live_tv_rounded), findsOneWidget);
  });
}
