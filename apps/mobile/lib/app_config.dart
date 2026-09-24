import 'dart:math';

const apiBaseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://gito-sports.onrender.com',
);

String? normalizeMediaUrl(Object? value, {String baseUrl = apiBaseUrl}) {
  final raw = value?.toString().trim();
  if (raw == null || raw.isEmpty) {
    return null;
  }

  final parsed = Uri.tryParse(raw);
  if (parsed != null && parsed.hasScheme && parsed.host.isNotEmpty) {
    return raw;
  }

  final base = Uri.tryParse(baseUrl);
  if (base == null || !base.hasScheme || base.host.isEmpty) {
    return null;
  }

  return base.resolve(raw).toString();
}

String? normalizeXtreamPlaybackUrl(Object? value) {
  final normalized = normalizeMediaUrl(value);
  if (normalized == null) {
    return null;
  }

  final parsed = Uri.tryParse(normalized);
  if (parsed == null || parsed.scheme != 'https' || !parsed.path.toLowerCase().contains('/live/')) {
    return normalized;
  }

  return parsed.replace(scheme: 'http').toString();
}

final String appSessionId = _generateSessionId();

String _generateSessionId() {
  final random = Random.secure();
  final values = List<int>.generate(16, (_) => random.nextInt(256));
  return values.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
}
