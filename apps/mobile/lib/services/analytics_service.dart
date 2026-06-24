import 'dart:convert';
import 'dart:io';

import 'package:firebase_crashlytics/firebase_crashlytics.dart';

import '../app_config.dart';

class MobileAnalyticsService {
  const MobileAnalyticsService();

  Future<List<MobilePromotion>> fetchPromotions() async {
    final uri = Uri.parse('$apiBaseUrl/analytics/promotions');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);

    try {
      final request = await client.getUrl(uri);
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      final response = await request.close().timeout(const Duration(seconds: 6));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const SocketException('Promotions unavailable');
      }

      final body = await response.transform(utf8.decoder).join();
      final decoded = jsonDecode(body) as Map<String, Object?>;
      final data = decoded['data'] as List<Object?>? ?? [];

      return data
          .whereType<Map<String, Object?>>()
          .map(MobilePromotion.fromJson)
          .toList(growable: false);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> trackEvent({
    required String eventType,
    String? matchId,
    Map<String, Object?>? payload,
    String? sessionId,
  }) async {
    final uri = Uri.parse('$apiBaseUrl/analytics/event');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);

    try {
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
      request.add(utf8.encode(jsonEncode({
        'eventType': eventType,
        'sessionId': sessionId ?? appSessionId,
        if (matchId != null) 'matchId': matchId,
        if (payload != null) 'payload': payload,
      })));
      final response = await request.close().timeout(const Duration(seconds: 6));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const SocketException('Analytics event failed');
      }
    } catch (error, stackTrace) {
      FirebaseCrashlytics.instance.recordError(
        error,
        stackTrace,
        reason: 'Failed to send analytics event',
        fatal: false,
      );
      rethrow;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> trackUserLogin({
    required String userId,
    required String loginMethod,
    String? sessionId,
  }) async {
    await trackEvent(
      eventType: 'user_login',
      sessionId: sessionId,
      payload: {
        'userId': userId,
        'loginMethod': loginMethod,
      },
    );
  }

  Future<void> trackAdEvent({
    required String eventType,
    String? promotionId,
    String? matchId,
    Map<String, Object?>? metadata,
    String? sessionId,
  }) async {
    final uri = Uri.parse('$apiBaseUrl/analytics/ad-event');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);

    try {
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
      request.add(utf8.encode(jsonEncode({
        'eventType': eventType,
        'sessionId': sessionId ?? appSessionId,
        if (promotionId != null) 'promotionId': promotionId,
        if (matchId != null) 'matchId': matchId,
        if (metadata != null) 'metadata': metadata,
      })));
      final response = await request.close().timeout(const Duration(seconds: 6));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const SocketException('Ad event failed');
      }
    } catch (error, stackTrace) {
      FirebaseCrashlytics.instance.recordError(
        error,
        stackTrace,
        reason: 'Failed to send ad event',
        fatal: false,
      );
      rethrow;
    } finally {
      client.close(force: true);
    }
  }
}

class MobilePromotion {
  const MobilePromotion({
    required this.id,
    required this.title,
    this.description,
    this.actionUrl,
    this.imageUrl,
  });

  final String id;
  final String title;
  final String? description;
  final String? actionUrl;
  final String? imageUrl;

  factory MobilePromotion.fromJson(Map<String, Object?> json) {
    return MobilePromotion(
      id: (json['id'] ?? 'promo').toString(),
      title: (json['title'] ?? 'GiTO Promotion').toString(),
      description: json['description']?.toString(),
      actionUrl: json['actionUrl']?.toString(),
      imageUrl: json['imageUrl']?.toString(),
    );
  }
}
