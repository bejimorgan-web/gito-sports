import 'dart:math';

const apiBaseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://gito-sports.onrender.com',
);

final String appSessionId = _generateSessionId();

String _generateSessionId() {
  final random = Random.secure();
  final values = List<int>.generate(16, (_) => random.nextInt(256));
  return values.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
}
